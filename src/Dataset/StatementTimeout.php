<?php

namespace Vifrost\Laravel\Dataset;

use Closure;
use Illuminate\Database\Connection;
use Illuminate\Database\QueryException;

/**
 * Bounds how long the database runs the queries of a connection's session, on the drivers
 * that support it: PostgreSQL (statement_timeout), MySQL (max_execution_time, SELECT only)
 * and MariaDB (max_statement_time). Other drivers run without a bound.
 */
class StatementTimeout
{
    /**
     * Sets the session's timeout and returns how to restore the previous one. Restoring
     * more than once does nothing, and so does it when nothing was set.
     *
     * @param \Illuminate\Database\Connection $connection
     * @param int|null $milliseconds null leaves the session as it is
     * @return \Closure(): void
     */
    public static function set(Connection $connection, ?int $milliseconds): Closure
    {
        $driver = self::driverOf($connection);

        if (is_null($milliseconds) || is_null($driver)) {
            return fn () => null;
        }

        $previous = match ($driver) {
            'pgsql' => $connection->selectOne('SHOW statement_timeout')->statement_timeout,
            'mysql' => $connection->selectOne('SELECT @@SESSION.max_execution_time AS timeout')->timeout,
            'mariadb' => $connection->selectOne('SELECT @@SESSION.max_statement_time AS timeout')->timeout,
        };

        self::apply($connection, $driver, $milliseconds);

        $restored = false;

        return function () use ($connection, $driver, $previous, &$restored) {
            if ($restored) {
                return;
            }
            $restored = true;
            self::restore($connection, $driver, $previous);
        };
    }

    /**
     * Whether a query failed because the database cancelled it for running too long.
     *
     * @param \Illuminate\Database\QueryException $exception
     * @return bool
     */
    public static function isTimeout(QueryException $exception): bool
    {
        $sqlState = $exception->errorInfo[0] ?? $exception->getCode();
        $driverCode = (int) ($exception->errorInfo[1] ?? 0);

        return $sqlState === '57014' || in_array($driverCode, [3024, 1969], true);
    }

    /**
     * The timeout dialect a connection speaks, or null when it has none.
     *
     * @param \Illuminate\Database\Connection $connection
     * @return string|null
     */
    private static function driverOf(Connection $connection): ?string
    {
        return match ($connection->getDriverName()) {
            'pgsql' => 'pgsql',
            'mariadb' => 'mariadb',
            'mysql' => method_exists($connection, 'isMaria') && $connection->isMaria() ? 'mariadb' : 'mysql',
            default => null,
        };
    }

    /**
     * @param \Illuminate\Database\Connection $connection
     * @param string $driver
     * @param int $milliseconds
     * @return void
     */
    private static function apply(Connection $connection, string $driver, int $milliseconds): void
    {
        match ($driver) {
            'pgsql' => $connection->statement('SET statement_timeout = ' . $milliseconds),
            'mysql' => $connection->statement('SET SESSION max_execution_time = ' . $milliseconds),
            'mariadb' => $connection->statement('SET SESSION max_statement_time = ' . ($milliseconds / 1000)),
        };
    }

    /**
     * @param \Illuminate\Database\Connection $connection
     * @param string $driver
     * @param mixed $previous the value the session had before
     * @return void
     */
    private static function restore(Connection $connection, string $driver, $previous): void
    {
        match ($driver) {
            'pgsql' => $connection->statement('SET statement_timeout = ' . $connection->getPdo()->quote((string) $previous)),
            'mysql' => $connection->statement('SET SESSION max_execution_time = ' . (int) $previous),
            'mariadb' => $connection->statement('SET SESSION max_statement_time = ' . (float) $previous),
        };
    }
}
