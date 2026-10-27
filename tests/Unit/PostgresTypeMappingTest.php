<?php

use Vifrost\Laravel\Describer;
use Vifrost\Laravel\FormRequest\ValidationGenerator;
use Vifrost\Laravel\Tests\Fixtures\PgProduct;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Postgres reports its own internal type-name aliases (int8, float8, bool, uuid, ...)
 * instead of the SQL-ish names MySQL/SQLite use, and formats defaults differently
 * ("'draft'::character varying", "nextval('...'::regclass)"). Skipped unless
 * PGSQL_TEST_HOST is set (see tests/TestCase.php and docker-compose.yml).
 */
beforeEach(function () {
    if (! getenv('PGSQL_TEST_HOST')) {
        $this->markTestSkipped('PGSQL_TEST_HOST not set, skipping Postgres-specific type mapping tests.');
    }

    Schema::connection('pgsql_test')->dropIfExists('pg_products');
    Schema::connection('pgsql_test')->create('pg_products', function (Blueprint $table) {
        $table->id();
        $table->string('name', 200);
        $table->float('rating')->nullable();
        $table->string('status', 20)->default('draft');
        $table->boolean('active')->default(true);
        $table->json('meta')->nullable();
        $table->uuid('external_id')->nullable();
        $table->smallInteger('rank')->nullable();
        $table->char('country', 2);
        $table->timestampTz('published_at');
        $table->timeTz('opens_at');
        $table->jsonb('surfaces');
    });
});

it('maps Postgres native type aliases to the same rules as their MySQL/SQLite equivalents', function () {
    $description = Describer::describe(new PgProduct);

    expect($description['id']['type'])->toBe('int8')
        ->and($description['rating']['type'])->toBe('float8')
        ->and($description['active']['type'])->toBe('bool')
        ->and($description['external_id']['type'])->toBe('uuid');

    $generate = fn ($column) => (new ValidationGenerator)->generate($description[$column]);

    expect($generate('id'))->toBe('integer')
        ->and($generate('rating'))->toBe('nullable|numeric')
        ->and($generate('active'))->toBe('boolean')
        ->and($generate('external_id'))->toBe('nullable|uuid')
        ->and($generate('rank'))->toBe('nullable|integer');
});

it('maps Postgres bpchar, timestamptz, timetz and jsonb columns', function () {
    $description = Describer::describe(new PgProduct);

    expect($description['country']['type'])->toBe('bpchar')
        ->and($description['published_at']['type'])->toBe('timestamptz')
        ->and($description['opens_at']['type'])->toBe('timetz')
        ->and($description['surfaces']['type'])->toBe('jsonb');

    $generate = fn ($column) => (new ValidationGenerator)->generate($description[$column]);

    expect($generate('country'))->toBe('required|string|max:2')
        ->and($generate('published_at'))->toBe('required|date')
        ->and($generate('opens_at'))->toBe('required|date_format:H:i,H:i:s')
        ->and($generate('surfaces'))->toBe('required|array');
});

it('does not report the auto-increment sequence expression as a real default value', function () {
    $description = Describer::describe(new PgProduct);

    expect($description['id']['hasDefaultValue'])->toBeFalse()
        ->and($description['id']['defaultValue'])->toBeNull()
        ->and($description['id']['hasAutoIncrement'])->toBeTrue();
});

it('strips the Postgres type cast and quoting from a string default', function () {
    $description = Describer::describe(new PgProduct);

    expect($description['status']['hasDefaultValue'])->toBeTrue()
        ->and($description['status']['defaultValue'])->toBe('draft');
});

it('still extracts string length from Postgres\' "character varying(N)" type text', function () {
    $description = Describer::describe(new PgProduct);

    expect($description['name']['length'])->toBe(200)
        ->and($description['status']['length'])->toBe(20);
});
