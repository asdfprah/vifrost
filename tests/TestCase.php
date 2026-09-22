<?php

namespace Vifrost\Laravel\Tests;

use Vifrost\Laravel\Providers\VifrostServiceProvider;
use Orchestra\Testbench\TestCase as Orchestra;
use ReflectionProperty;

abstract class TestCase extends Orchestra
{
    protected function getPackageProviders($app)
    {
        return [
            VifrostServiceProvider::class,
        ];
    }

    protected function defineEnvironment($app)
    {
        $app['config']->set('database.default', 'testing');
        $app['config']->set('database.connections.testing', $this->testConnectionConfig());

        // Always available (independent of which driver "testing" points to this run)
        // for PostgresTypeMappingTest, which specifically checks Postgres's own
        // type-name aliases (int8, float8, bool, uuid, ...) regardless of which driver
        // the main suite is targeting in this CI leg.
        if (getenv('PGSQL_TEST_HOST')) {
            $app['config']->set('database.connections.pgsql_test', [
                'driver' => 'pgsql',
                'host' => getenv('PGSQL_TEST_HOST'),
                'port' => getenv('PGSQL_TEST_PORT') ?: 5432,
                'database' => getenv('PGSQL_TEST_DATABASE') ?: 'vifrost_test',
                'username' => getenv('PGSQL_TEST_USERNAME') ?: 'postgres',
                'password' => getenv('PGSQL_TEST_PASSWORD') ?: '',
            ]);
        }

        // Same idea, for MariaDbJsonLimitationTest: MariaDB reports a json() column as
        // "longtext" (it's a LONGTEXT + CHECK constraint under the hood, not a real
        // native JSON type), which this package cannot recover from schema introspection.
        if (getenv('MARIADB_TEST_HOST')) {
            $app['config']->set('database.connections.mariadb_test', [
                'driver' => 'mariadb',
                'host' => getenv('MARIADB_TEST_HOST'),
                'port' => getenv('MARIADB_TEST_PORT') ?: 3306,
                'database' => getenv('MARIADB_TEST_DATABASE') ?: 'vifrost_test',
                'username' => getenv('MARIADB_TEST_USERNAME') ?: 'root',
                'password' => getenv('MARIADB_TEST_PASSWORD') ?: '',
            ]);
        }

        $app->useAppPath(__DIR__ . '/Fixtures');
        $namespace = new ReflectionProperty($app, 'namespace');
        $namespace->setAccessible(true);
        $namespace->setValue($app, 'Vifrost\\Laravel\\Tests\\Fixtures\\');
        $app['config']->set('vifrost.models_path', '');
    }

    /**
     * Which driver the "testing" connection uses is selected via TEST_DB_CONNECTION
     * (sqlite|mysql|mariadb|pgsql), defaulting to an in-memory SQLite database so the
     * default suite needs no services at all. Native schema introspection reports
     * different type-name conventions per driver (see DescriberTest and MapperTest),
     * so CI runs the whole suite once per driver instead of only exercising SQLite.
     *
     * @return array
     */
    protected function testConnectionConfig(): array
    {
        $driver = getenv('TEST_DB_CONNECTION') ?: 'sqlite';

        if ($driver === 'sqlite') {
            return [
                'driver' => 'sqlite',
                'database' => ':memory:',
                'prefix' => '',
            ];
        }

        $prefix = strtoupper($driver) . '_TEST_';

        return [
            'driver' => $driver,
            'host' => getenv($prefix . 'HOST') ?: '127.0.0.1',
            'port' => getenv($prefix . 'PORT') ?: ($driver === 'pgsql' ? 5432 : 3306),
            'database' => getenv($prefix . 'DATABASE') ?: 'vifrost_test',
            'username' => getenv($prefix . 'USERNAME') ?: 'root',
            'password' => getenv($prefix . 'PASSWORD') ?: '',
        ];
    }
}
