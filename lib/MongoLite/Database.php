<?php

namespace MongoLite;

use PDO;

/**
 * Database object.
 */
class Database {

    /**
     * @var string - DSN path form memory database
     */
    public const DSN_PATH_MEMORY = ':memory:';

    /**
     * @var PDO|\Pdo\Sqlite object
     */
    public PDO $connection;

    /**
     * @var array
     */
    protected array $collections = [];

    /**
     * @var string
     */
    protected string $path;

    /**
     * @var array
     */
    protected array $document_criterias = [];

    /**
     * @var Query\Optimizer|null
     */
    protected ?Query\Optimizer $queryOptimizer = null;

    /**
     * @var Aggregation\Optimizer|null
     */
    protected ?Aggregation\Optimizer $aggregationOptimizer = null;

    /**
     * @var array<string, array<string, bool>>
     */
    protected array $sortOptimizationCache = [];

    /**
     * Constructor
     *
     * @param string $path
     * @param array  $options
     */
    public function __construct(string $path = self::DSN_PATH_MEMORY, array $options = []) {

        $dns = "sqlite:{$path}";
        $this->path = $path;

        if (\class_exists('Pdo\Sqlite')) {
            $this->connection = new \Pdo\Sqlite($dns, null, null, $options);
        } else {
            $this->connection = new PDO($dns, null, null, $options);
        }

        $database = $this;

        $fn_document_key = function($key, $document){

            $document = \json_decode($document, true);
            $val      = '';

            // Use generic traversal for any depth of nesting
            if (\str_contains($key, '.')) {
                $keys = \explode('.', $key);
                $current = $document;
                
                // Traverse the nested structure
                foreach ($keys as $k) {
                    if (\is_array($current) && isset($current[$k])) {
                        $current = $current[$k];
                    } else {
                        $current = '';
                        break;
                    }
                }
                $val = $current;
            } else {
                $val = isset($document[$key]) ? $document[$key] : '';
            }

            return \is_array($val) || \is_object($val) ? \json_encode($val) : $val;
        };

        $fn_document_criteria = function($funcid, $document) use($database) {

            $document = \json_decode($document, true);

            return $database->callCriteriaFunction($funcid, $document);
        };

        if (\method_exists($this->connection, 'createFunction')) {
            $this->connection->createFunction('document_key', $fn_document_key, 2);
            $this->connection->createFunction('document_criteria', $fn_document_criteria, 2);
        } else {
            $this->connection->sqliteCreateFunction('document_key', $fn_document_key, 2);
            $this->connection->sqliteCreateFunction('document_criteria', $fn_document_criteria, 2);
        }

        $pragma = [
            'journal_mode'  => $options['journal_mode'] ??  'WAL',
            'temp_store'  => $options['temp_store'] ??  'MEMORY',
            'journal_size_limit' => $options['journal_size_limit'] ?? '27103364',
            'synchronous'   => $options['synchronous'] ?? 'NORMAL',
            'mmap_size'     => $options['mmap_size'] ?? '134217728',
            'cache_size'    => $options['cache_size'] ?? '-20000',
            'page_size'     => $options['page_size'] ?? '8192',
            'busy_timeout'  => $options['busy_timeout'] ?? '5000',
            'auto_vacuum'  => $options['auto_vacuum'] ?? 'INCREMENTAL',
        ];

        foreach ($pragma as $key => $value) {
            $this->connection->exec("PRAGMA {$key} = {$value}");
        }
    }

    /**
     * Register Criteria function
     *
     * @param  mixed $criteria
     * @return mixed
     */
    public function registerCriteriaFunction(mixed $criteria): ?string {

        $id = \uniqid('criteria');

        if ($criteria instanceof \Closure) {
            $this->document_criterias[$id] = ClosureGuard::requireAnonymous(
                $criteria,
                'Criteria callable must be an anonymous Closure'
            );
            return $id;
        }

        if (\is_callable($criteria)) {
            throw new \InvalidArgumentException('Criteria callable must be an anonymous Closure');
        }

        if (\is_array($criteria)) {

            $fn = UtilArrayQuery::getFilterFunction($criteria);

            $this->document_criterias[$id] = $fn;

            return $id;
        }

        return null;
    }

    /**
     * Unregisters a criteria function by its identifier.
     *
     * @param string $id The identifier of the criteria function to be unregistered.
     * @return void
     */
    public function unregisterCriteriaFunction(string $id): void {
        if (isset($this->document_criterias[$id])) unset($this->document_criterias[$id]);
    }

    /**
     * Execute registred criteria function
     *
     * @param  string $id
     * @param  array $document
     * @return boolean
     */
    public function callCriteriaFunction(string $id, ?array $document = null): mixed {
        return isset($this->document_criterias[$id]) ? $this->document_criterias[$id]($document):false;
    }

    /**
     * Vacuum database
     */
    public function vacuum(): void {
        $this->connection->query('VACUUM');
    }

    /**
     * Drop database
     */
    public function drop(): void {

        if ($this->path !== static::DSN_PATH_MEMORY) {
            if (\file_exists($this->path)) \unlink($this->path);
            if (\file_exists("{$this->path}-shm")) \unlink("{$this->path}-shm");
            if (\file_exists("{$this->path}-wal")) \unlink("{$this->path}-wal");
            if (\file_exists("{$this->path}-journal")) \unlink("{$this->path}-journal");
        }
    }

    /**
     * Create a collection
     *
     * @param  string $name
     */
    public function createCollection(string $name): void {
        // Sanitize collection name to prevent SQL injection
        $sanitizedName = $this->sanitizeCollectionName($name);
        if (!$sanitizedName) {
            throw new \InvalidArgumentException("Invalid collection name: {$name}");
        }
        
        $this->connection->exec("CREATE TABLE IF NOT EXISTS `{$sanitizedName}` ( id INTEGER PRIMARY KEY AUTOINCREMENT, document TEXT )");
        unset($this->sortOptimizationCache[$sanitizedName]);
    }

    /**
     * Drop a collection
     *
     * @param  string $name
     */
    public function dropCollection(string $name): void {
        // Sanitize collection name to prevent SQL injection
        $sanitizedName = $this->sanitizeCollectionName($name);
        if (!$sanitizedName) {
            throw new \InvalidArgumentException("Invalid collection name: {$name}");
        }
        
        $this->connection->exec("DROP TABLE `{$sanitizedName}`");

        // Remove collection from cache
        unset($this->collections[$name]);
        unset($this->sortOptimizationCache[$sanitizedName]);
    }

    /**
     * Get all collection names in the database
     *
     * @return array
     */
    public function getCollectionNames(): array {

        $stmt   = $this->connection->query("SELECT name FROM sqlite_master WHERE type='table' AND name!='sqlite_sequence';");
        $tables = $stmt->fetchAll( \PDO::FETCH_ASSOC);
        $names  = [];

        foreach ($tables as $table) {
            $names[] = $table['name'];
        }

        return $names;
    }

    /**
     * Get all collections in the database
     *
     * @return array
     */
    public function listCollections(): array {

        foreach ($this->getCollectionNames() as $name) {
            if(!isset($this->collections[$name])) {
                $this->collections[$name] = new Collection($name, $this);
            }
        }

        return $this->collections;
    }

    /**
     * Select collection
     *
     * @param  string $name
     * @return object
     */
    public function selectCollection(string $name): Collection {

        if (!isset($this->collections[$name])) {

            if (!\in_array($name, $this->getCollectionNames())) {
                $this->createCollection($name);
            }

            $this->collections[$name] = new Collection($name, $this);
        }

        return $this->collections[$name];
    }

    public function __get($collection) {
        return $this->selectCollection($collection);
    }
    
    /**
     * Sanitize collection name to prevent SQL injection
     * Only allow alphanumeric characters, underscores, and hyphens
     * 
     * @param string $name
     * @return string|null Sanitized name or null if invalid
     */
    public function sanitizeCollectionName(string $name): ?string {
        // Remove any characters that aren't alphanumeric, underscore, or hyphen
        $sanitized = \preg_replace('/[^a-zA-Z0-9_-]/', '', $name);
        
        // Check if the sanitized name matches the original and isn't empty
        if ($sanitized === $name && !empty($sanitized) && \strlen($sanitized) <= 64) {
            return $sanitized;
        }
        
        return null;
    }
    
    /**
     * Sanitize criteria function ID to prevent SQL injection
     * 
     * @param string $id
     * @return string|null Sanitized ID or null if invalid
     */
    public function sanitizeCriteriaId(string $id): ?string {
        // Only allow alphanumeric characters - criteria IDs are generated by uniqid()
        $sanitized = \preg_replace('/[^a-zA-Z0-9]/', '', $id);
        
        if ($sanitized === $id && !empty($sanitized)) {
            return $sanitized;
        }
        
        return null;
    }

    /**
     * Get Query Optimizer instance
     */
    public function getQueryOptimizer(): Query\Optimizer {
        if (!isset($this->queryOptimizer)) {
            $this->queryOptimizer = new Query\Optimizer($this->connection);
        }
        return $this->queryOptimizer;
    }

    /**
     * Get Aggregation Optimizer instance
     */
    public function getAggregationOptimizer(): Aggregation\Optimizer {
        if (!isset($this->aggregationOptimizer)) {
            $this->aggregationOptimizer = new Aggregation\Optimizer(
                $this->connection,
                $this->getQueryOptimizer()
            );
        }
        return $this->aggregationOptimizer;
    }

    /**
     * Determine whether sorting a field via json_extract() is safe to use
     * without changing the legacy document_key() order semantics.
     *
     * Safe cases are intentionally narrow:
     * - the field exists on every document
     * - the field is never JSON null
     * - the field values belong to exactly one scalar family:
     *   text, number (integer/real), or bool (true/false)
     */
    public function canUseOptimizedSort(string $collectionName, string $field): bool {

        if (!\preg_match('/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/', $field)) {
            return false;
        }

        $sanitizedCollection = $this->sanitizeCollectionName($collectionName);

        if (!$sanitizedCollection) {
            return false;
        }

        if (isset($this->sortOptimizationCache[$sanitizedCollection][$field])) {
            return $this->sortOptimizationCache[$sanitizedCollection][$field];
        }

        if (!$this->collectionTableExists($sanitizedCollection)) {
            $this->sortOptimizationCache[$sanitizedCollection][$field] = false;
            return false;
        }

        $path = $this->connection->quote('$.'.$field);
        $sql = <<<SQL
SELECT
    COALESCE(SUM(CASE WHEN jt IS NULL OR jt = 'null' THEN 1 ELSE 0 END), 0) AS nullish_count,
    COALESCE(COUNT(DISTINCT CASE
        WHEN jt IN ('integer', 'real') THEN 'number'
        WHEN jt IN ('true', 'false') THEN 'bool'
        ELSE jt
    END), 0) AS family_count,
    COALESCE(MAX(CASE
        WHEN jt IN ('integer', 'real', 'text', 'true', 'false') THEN 0
        ELSE 1
    END), 0) AS has_non_scalar
FROM (
    SELECT json_type(document, {$path}) AS jt
    FROM `{$sanitizedCollection}`
) sort_probe
SQL;

        try {
            $stats = $this->connection->query($sql)?->fetch(\PDO::FETCH_ASSOC) ?: [];
        } catch (\PDOException) {
            $this->sortOptimizationCache[$sanitizedCollection][$field] = false;
            return false;
        }

        $safe = (int)($stats['nullish_count'] ?? 0) === 0
            && (int)($stats['family_count'] ?? 0) === 1
            && (int)($stats['has_non_scalar'] ?? 0) === 0;

        $this->sortOptimizationCache[$sanitizedCollection][$field] = $safe;

        return $safe;
    }

    /**
     * Invalidate cached sort-safety decisions for a collection or the whole DB.
     */
    public function invalidateSortOptimizationCache(?string $collectionName = null): void {

        if ($collectionName === null) {
            $this->sortOptimizationCache = [];
            return;
        }

        $sanitizedCollection = $this->sanitizeCollectionName($collectionName);

        if ($sanitizedCollection) {
            unset($this->sortOptimizationCache[$sanitizedCollection]);
        }
    }

    protected function collectionTableExists(string $sanitizedCollection): bool {

        $stmt = $this->connection->prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :name LIMIT 1"
        );

        if (!$stmt) {
            return false;
        }

        $stmt->execute([':name' => $sanitizedCollection]);

        return (bool)$stmt->fetchColumn();
    }
}


function createMongoDbLikeId(): string {

    // use native MongoDB ObjectId if available
    if (\class_exists('MongoDB\\BSON\\ObjectId')) {
        $objId = new \MongoDB\BSON\ObjectId();
        return (string)$objId;
    }

    // 4 bytes: timestamp (seconds since epoch)
    $timestamp = \pack('N', \time());

    // 5 bytes: combination of host-specific and random data
    // Instead of trying to convert hex strings directly, use binary data
    $hostHash = \md5(\php_uname('n'), true); // Get binary hash
    $processHash = \md5(\getmypid(), true); // Get binary hash

    // Take portions of these hashes to create 5 bytes
    $machineSpecificBytes = \substr($hostHash, 0, 3) . \substr($processHash, 0, 2);

    // 3 bytes: incrementing counter
    static $counter = null;
    if ($counter === null) {
        // Start from a random position each time the function is first called
        $counter = \random_int(0, 0xFFFFFF);
    }
    $counter = ($counter + 1) & 0xFFFFFF;
    $counterBytes = \substr(\pack('N', $counter), 1, 3);

    // Combine all parts and convert to hex
    return \bin2hex($timestamp . $machineSpecificBytes . $counterBytes);
}
