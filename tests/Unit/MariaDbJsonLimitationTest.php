<?php

use Vifrost\Laravel\Describer;
use Vifrost\Laravel\FormRequest\ValidationGenerator;
use Vifrost\Laravel\Tests\Fixtures\MariaDbProduct;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * MariaDB implements json() columns as LONGTEXT with a CHECK constraint validating
 * JSON — there is no distinct native JSON type to introspect. Schema::getColumns()
 * reports such a column as type_name "longtext", indistinguishable from a plain
 * text column. This is a real, permanent limitation of MariaDB itself, not a gap in
 * this package: the "json" validation rule can never be applied automatically to a
 * MariaDB json() column. This test pins that behavior so it isn't mistaken for a
 * regression later. Skipped unless MARIADB_TEST_HOST is set (see tests/TestCase.php
 * and docker-compose.yml).
 */
beforeEach(function () {
    if (! getenv('MARIADB_TEST_HOST')) {
        $this->markTestSkipped('MARIADB_TEST_HOST not set, skipping MariaDB-specific tests.');
    }

    Schema::connection('mariadb_test')->dropIfExists('mariadb_products');
    Schema::connection('mariadb_test')->create('mariadb_products', function (Blueprint $table) {
        $table->id();
        $table->string('name', 200);
        $table->json('meta')->nullable();
    });
});

it('reports a MariaDB json() column as longtext, not json', function () {
    $description = Describer::describe(new MariaDbProduct);

    expect($description['meta']['type'])->toBe('longtext');
});

it('falls back to a string rule for a MariaDB json column, since it cannot be told apart from free text', function () {
    $description = Describer::describe(new MariaDbProduct);

    expect((new ValidationGenerator)->generate($description['meta']))->toBe('nullable|string');
});
