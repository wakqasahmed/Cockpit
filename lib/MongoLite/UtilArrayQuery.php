<?php

namespace MongoLite;

use MongoLite\Expression\Evaluator;
use MongoLite\Query\Operators;

/**
 * Array query utilities - facade for query filtering and expression evaluation
 */
class UtilArrayQuery {

    protected static array $closures = [];

    /**
     * Create a filter function from criteria array
     */
    public static function getFilterFunction(array $criteria): callable {
        return empty($criteria) ?
            fn() => true :
            fn($document) => self::evaluateCondition($document, $criteria);
    }

    /**
     * Main method to evaluate if a document matches the given criteria
     */
    public static function evaluateCondition($document, array $criteria): bool {
        if (empty($criteria)) {
            return true;
        }

        foreach ($criteria as $key => $value) {
            // Handle special top-level operators
            if ($key[0] === '$') {
                $topLevelOperators = ['$and', '$or', '$where', '$nor', '$expr'];

                if (\in_array($key, $topLevelOperators)) {
                    switch ($key) {
                        case '$and':
                            if (!\is_array($value)) {
                                return false;
                            }
                            foreach ($value as $subCriteria) {
                                if (!self::evaluateCondition($document, $subCriteria)) {
                                    return false;
                                }
                            }
                            break;

                        case '$or':
                            if (!\is_array($value)) {
                                return false;
                            }
                            $orResult = false;
                            foreach ($value as $subCriteria) {
                                if (self::evaluateCondition($document, $subCriteria)) {
                                    $orResult = true;
                                    break;
                                }
                            }
                            if (!$orResult) {
                                return false;
                            }
                            break;

                        case '$where':
                            $value = \MongoLite\ClosureGuard::requireAnonymous(
                                $value,
                                $key . ' function should be an anonymous Closure'
                            );
                            $uid = self::registerClosure($value);
                            if (!self::closureCall($uid, $document)) {
                                return false;
                            }
                            break;

                        case '$nor':
                            if (!\is_array($value)) {
                                return false;
                            }
                            foreach ($value as $subCriteria) {
                                if (self::evaluateCondition($document, $subCriteria)) {
                                    return false;
                                }
                            }
                            break;

                        case '$expr':
                            if (!\is_array($value)) {
                                return false;
                            }
                            // Use the new Expression evaluator
                            if (!Evaluator::evaluate($value, $document)) {
                                return false;
                            }
                            break;
                    }
                } else {
                    // Handle field with operator name as a regular field
                    $fieldValue = self::getNestedValue($document, $key);
                    if (\is_array($value) && !empty($value) && isset(\array_keys($value)[0]) && \array_keys($value)[0][0] === '$') {
                        if (!self::check($fieldValue, $value)) {
                            return false;
                        }
                    } elseif (\is_null($value)) {
                        if (self::getNestedValueExists($document, $key) && $fieldValue !== null) {
                            return false;
                        }
                    } else {
                        if (!self::getNestedValueExists($document, $key) || !self::matchesDirectValue($fieldValue, $value)) {
                            return false;
                        }
                    }
                }
            } else {
                // Handle field conditions
                $fieldValue = self::getNestedValue($document, $key);

                if (\is_array($value) && !empty($value)) {
                    $firstKey = \array_keys($value)[0];
                    if (\is_string($firstKey) && \str_starts_with($firstKey, '$')) {
                        // Handle $exists specially
                        if (isset($value['$exists'])) {
                            $fieldExists = self::getNestedValueExists($document, $key);
                            $shouldExist = (bool)$value['$exists'];
                            if ($fieldExists !== $shouldExist) {
                                return false;
                            }
                            $otherConditions = \array_diff_key($value, ['$exists' => true]);
                            if (!empty($otherConditions)) {
                                if (!$fieldExists) {
                                    return false;
                                }
                                if (!self::check($fieldValue, $otherConditions)) {
                                    return false;
                                }
                            }
                        } else {
                            if (!self::check($fieldValue, $value)) {
                                return false;
                            }
                        }
                    } else {
                        if (!self::matchesDirectValue($fieldValue, $value)) {
                            return false;
                        }
                    }
                } elseif (\is_null($value)) {
                    if (self::getNestedValueExists($document, $key) && $fieldValue !== null) {
                        return false;
                    }
                } else {
                    if (!self::getNestedValueExists($document, $key) || !self::matchesDirectValue($fieldValue, $value)) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Direct field equality with MongoDB-like array semantics.
     * If a field is a list array, scalar/object equality should match
     * when any top-level array element equals the query value.
     */
    private static function matchesDirectValue(mixed $fieldValue, mixed $queryValue): bool {
        if (\is_array($fieldValue) && \array_is_list($fieldValue)) {
            if ($fieldValue == $queryValue) {
                return true;
            }

            foreach ($fieldValue as $item) {
                if ($item == $queryValue) {
                    return true;
                }
            }

            return false;
        }

        return $fieldValue == $queryValue;
    }

    /**
     * Check if a value matches query conditions
     */
    public static function check(mixed $value, array $condition): bool {
        // Operators that work on the whole array, not individual elements
        $wholeArrayOperators = ['$all', '$size', '$elemMatch', '$has', '$geoWithin', '$geoIntersects', '$near'];
        $hasWholeArrayOperator = false;
        foreach ($condition as $key => $_) {
            if (\in_array($key, $wholeArrayOperators)) {
                $hasWholeArrayOperator = true;
                break;
            }
        }

        // If value is an array and no whole-array operator, check if any element matches
        if (\is_array($value) && !$hasWholeArrayOperator) {
            return self::checkArrayWithCondition($value, $condition);
        }

        // Use the Query Operators class (for whole-array operators or non-array values)
        return Operators::checkConditions($value, $condition);
    }

    /**
     * Check if any element in an array matches the condition
     */
    private static function checkArrayWithCondition(array $arr, array $condition): bool {
        foreach ($arr as $item) {
            if (\is_array($item)) {
                if (self::checkArrayWithCondition($item, $condition)) {
                    return true;
                }
            } else {
                if (Operators::checkConditions($item, $condition)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get a nested value from an array using dot notation
     */
    public static function getNestedValue(array $array, string $path): mixed {
        $keys = \explode('.', $path);

        foreach ($keys as $key) {
            if (!\is_array($array) || !\array_key_exists($key, $array)) {
                return null;
            }
            $array = $array[$key];
        }

        return $array;
    }

    /**
     * Check if a nested value exists in an array
     */
    public static function getNestedValueExists(array $array, string $path): bool {
        $keys = \explode('.', $path);

        foreach ($keys as $key) {
            if (!\is_array($array) || !\array_key_exists($key, $array)) {
                return false;
            }
            $array = $array[$key];
        }

        return true;
    }

    /**
     * Evaluate an expression (delegates to Expression\Evaluator)
     * @deprecated Use Expression\Evaluator::evaluate() directly
     */
    public static function evaluateExpression(array $expr, array $doc): mixed {
        return Evaluator::evaluate($expr, $doc);
    }

    /**
     * Evaluate an operand (delegates to Expression\Evaluator)
     * @deprecated Use Expression\Evaluator::resolveOperand() directly
     */
    public static function evaluateExpressionOperands($operand, array $doc): mixed {
        return Evaluator::resolveOperand($operand, $doc);
    }

    /**
     * Register a closure for $where queries
     */
    protected static function registerClosure(\Closure $closure): string {
        $uid = \uniqid('closure_');
        self::$closures[$uid] = $closure;
        return $uid;
    }

    /**
     * Call a registered closure
     */
    protected static function closureCall(string $uid, array $document): bool {
        if (!isset(self::$closures[$uid])) {
            return false;
        }
        return (bool)self::$closures[$uid]($document);
    }
}
