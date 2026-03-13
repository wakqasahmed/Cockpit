<?php

namespace MongoLite;

final class ClosureGuard {

    public static function requireAnonymous(mixed $callback, string $message): \Closure {
        if (!$callback instanceof \Closure) {
            throw new \InvalidArgumentException($message);
        }

        $reflection = new \ReflectionFunction($callback);

        if ($reflection->isInternal() || !\str_starts_with($reflection->getName(), '{closure')) {
            throw new \InvalidArgumentException($message);
        }

        return $callback;
    }
}
