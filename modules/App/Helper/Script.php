<?php

namespace App\Helper;

use ScriptLite\Engine;

class Script extends \Lime\Helper {

    protected Engine $engine;

    protected function initialize() {
        $this->engine = new Engine();
    }

    /**
     * Evaluate a JS expression and return the result.
     *
     * @param string $source JS source code.
     * @param array $globals Variables available in the script scope.
     * @return mixed The evaluation result.
     */
    public function eval(string $source, array $globals = []): mixed {

        try {
            return $this->engine->eval($source, $globals);
        } catch (\Throwable $e) {
            $this->app->trigger('script.error', [$source, $e]);
            return null;
        }
    }

    /**
     * Compile a JS source once for repeated execution.
     *
     * @param string $source JS source code.
     * @return mixed Compiled script handle.
     */
    public function compile(string $source): mixed {

        try {
            return $this->engine->compile($source);
        } catch (\Throwable $e) {
            $this->app->trigger('script.error', [$source, $e]);
            return null;
        }
    }

    /**
     * Execute a previously compiled script.
     *
     * @param mixed $compiled Compiled script handle from compile().
     * @param array $globals Variables available in the script scope.
     * @return mixed The execution result.
     */
    public function run(mixed $compiled, array $globals = []): mixed {

        if (!$compiled) return null;

        try {
            return $this->engine->run($compiled, $globals);
        } catch (\Throwable $e) {
            $this->app->trigger('script.error', [null, $e]);
            return null;
        }
    }

    /**
     * Evaluate a JS expression as a boolean test.
     *
     * @param string $expression JS expression.
     * @param array $globals Variables available in the script scope.
     * @return bool
     */
    public function test(string $expression, array $globals = []): bool {
        return !empty($this->eval($expression, $globals));
    }

    /**
     * Execute a script and return the result, or $default on failure.
     *
     * @param string $source JS source code.
     * @param array $globals Variables available in the script scope.
     * @param mixed $default Fallback value on error.
     * @return mixed
     */
    public function execute(string $source, array $globals = [], mixed $default = null): mixed {
        $result = $this->eval($source, $globals);
        return $result ?? $default;
    }

    /**
     * Get console.log output from the last execution.
     *
     * @return string
     */
    public function getOutput(): string {
        return $this->engine->getOutput();
    }

    /**
     * Get the underlying ScriptLite engine instance.
     *
     * @return Engine
     */
    public function engine(): Engine {
        return $this->engine;
    }
}
