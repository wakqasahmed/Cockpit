<?php

namespace Lime\Helper;

use Lime\Request;
use function \Lime\fetch_from_array;

class Session extends \Lime\Helper {

    protected bool $initialized = false;
    public string $name = '';
    protected array $session = [];
    protected static ?array $defaultCookieParams = null;

    public function init(?string $name = null): void {

        if ($this->initialized) return;

        if (\session_status() != \PHP_SESSION_ACTIVE) {

            $this->name = $name ?: $this->app->retrieve('session.name');

            $this->configureCookieParams();
            
            \session_name($this->name);
            \session_start();
        } else {
            $this->name = \session_name();
        }

        $this->initialized = true;

        if (isset($_SESSION) && \is_array($_SESSION)) {
            $this->session = &$_SESSION;
        } else {
            $this->session = [];
        }
    }

    protected function configureCookieParams(): void {

        @\ini_set('session.use_only_cookies', '1');
        @\ini_set('session.use_strict_mode', '1');

        if (self::$defaultCookieParams === null) {
            self::$defaultCookieParams = \session_get_cookie_params();
        }

        $cookieConfig = $this->app->retrieve('session.cookie', []);

        if (!\is_array($cookieConfig)) {
            $cookieConfig = [];
        }

        $params = \array_merge([
            'lifetime' => self::$defaultCookieParams['lifetime'] ?? 0,
            'path' => self::$defaultCookieParams['path'] ?? '/',
            'domain' => self::$defaultCookieParams['domain'] ?? '',
            'secure' => $this->isSecureRequest(),
            'httponly' => true,
            'samesite' => self::$defaultCookieParams['samesite'] ?? 'Lax',
        ], $cookieConfig);

        $params['lifetime'] = \is_numeric($params['lifetime']) ? \intval($params['lifetime']) : 0;
        $params['path'] = \is_string($params['path']) && $params['path'] ? $params['path'] : '/';
        $params['domain'] = \is_string($params['domain']) ? $params['domain'] : '';
        $params['secure'] = (bool) $params['secure'];
        $params['httponly'] = (bool) $params['httponly'];

        $sameSite = \ucfirst(\strtolower((string) ($params['samesite'] ?? 'Lax')));
        $params['samesite'] = \in_array($sameSite, ['Lax', 'Strict', 'None'], true) ? $sameSite : 'Lax';

        // Modern browsers require Secure when SameSite=None is used.
        if ($params['samesite'] === 'None') {
            $params['secure'] = true;
        }

        \session_set_cookie_params($params);
    }

    protected function isSecureRequest(): bool {

        $requestIsSecure = $this->app->request instanceof Request && $this->app->request->is('ssl');

        if ($requestIsSecure || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')) {
            return true;
        }

        if (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443') {
            return true;
        }

        $forwardedProto = \strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ($_SERVER['HTTP_X_FORWARDED_PROTOCOL'] ?? ''));

        if (\in_array($forwardedProto, ['https', 'ssl'], true)) {
            return true;
        }

        return \strtolower($_SERVER['HTTP_X_FORWARDED_SSL'] ?? '') === 'on';
    }

    /**
     * Retrieves the session data.
     *
     * @return array The session data.
     */
    public function getSession(): array {
        return $this->session;
    }

    /**
     * Writes a value to the session data using the given key.
     *
     * @param string $key The key to associate with the value in the session.
     * @param mixed $value The value to store in the session.
     * @return void
     */
    public function write(string $key, mixed $value): void {
        $this->session[$key] = $value;
    }

    /**
     * Reads a value from the session array using the specified key. If the key does not exist, a default value can be returned.
     *
     * @param string $key The key to retrieve the value from the session array.
     * @param mixed $default The default value to return if the key does not exist in the session array.
     * @return mixed The value associated with the specified key, or the default value if the key does not exist.
     */
    public function read(string $key, mixed $default = null) {
        return fetch_from_array($this->session, $key, $default);
    }

    /**
     * Deletes a value from the session array using the specified key.
     *
     * @param string $key The key of the value to be removed from the session array.
     * @return void
     */
    public function delete(string $key): void {
        unset($this->session[$key]);
    }

    /**
     * Destroys the current session and removes all session data.
     *
     * @return void
     */
    public function destroy(): void {
        if (\session_status() == \PHP_SESSION_ACTIVE) {
            \session_destroy();
        }
    }

    /**
     * Closes the current session and writes session data if necessary.
     *
     * @return void
     */
    public function close(): void {
        if (\session_status() == \PHP_SESSION_ACTIVE) {
            \session_write_close();
        }
    }

    /**
     * Regenerates the session ID and optionally deletes the old session data.
     *
     * @param bool $delete_old_session Whether to delete the old session data. Defaults to false.
     * @return bool Returns true on success or false on failure.
     */
    public function regenerateId(bool $delete_old_session = false): bool {

        if (\session_status() != \PHP_SESSION_ACTIVE) {
            return false;
        }

        if ($delete_old_session) {

            foreach ($this->session as $key => $value) {
                unset($this->session[$key]);
            }
        }

        return \session_regenerate_id($delete_old_session);
    }
}
