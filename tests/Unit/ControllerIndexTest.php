<?php

use Vifrost\Laravel\Vifrost;
use Vifrost\Laravel\Tests\Fixtures\Category;
use Vifrost\Laravel\Tests\Fixtures\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Spatie\QueryBuilder\QueryBuilder;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Regression coverage for Controller.stub's index(): this runs the REAL generated
 * controller (via the actual vifrost:controller command), not a hand-written copy of
 * its logic — a change to the stub that isn't reflected here fails these tests instead
 * of silently drifting out of sync with what actually ships.
 */
function generatedProductControllerClass(): string
{
    static $generated = false;

    if (! class_exists('App\Http\Controllers\Controller', false)) {
        class_alias(\Illuminate\Routing\Controller::class, 'App\Http\Controllers\Controller');
    }

    if (! class_exists('App\Models\Product', false)) {
        class_alias(Product::class, 'App\Models\Product');
    }

    if (! $generated) {
        File::deleteDirectory(__DIR__ . '/../Fixtures/Http');
        Artisan::call('vifrost:controller', ['model' => 'Product', '--force' => true]);
        require_once __DIR__ . '/../Fixtures/Http/Controllers/ProductController.php';
        class_alias('App\Http\Controllers\ProductController', 'Vifrost\Laravel\Tests\Fixtures\Http\Controllers\ProductController');
        $generated = true;
    }

    return 'App\Http\Controllers\ProductController';
}

afterAll(function () {
    File::deleteDirectory(__DIR__ . '/../Fixtures/Http');
});

function controllerIndexFor(string $path, array $query = []): array
{
    $controllerClass = generatedProductControllerClass();

    app()->instance('request', Request::create('/' . $path, 'GET', $query));

    $response = (new $controllerClass())->index();

    $rows = collect(json_decode($response->getContent(), true));
    $total = (int) $response->headers->get('X-Total-Count');

    return [$rows, $total];
}

beforeEach(function () {
    createTestSchema();

    config(['vifrost.max_limit' => 100]);
    config(['vifrost.max_limit_per_model' => []]);

    $this->category = Category::create(['name' => 'Widgets']);
    collect(range(1, 5))->each(fn($n) => Product::create([
        'category_id' => $this->category->id,
        'name' => "Gadget {$n}",
        'price' => 9.99,
        'status' => 'active',
    ]));
});

it('applies the global max_limit by default, with no ?limit= at all, and reports the real total', function () {
    config(['vifrost.max_limit' => 3]);

    [$rows, $total] = controllerIndexFor('api/product');

    expect($rows)->toHaveCount(3);
    expect($total)->toBe(5);
});

it('responds 404 from show() for a missing record instead of an empty 200', function () {
    $controllerClass = generatedProductControllerClass();
    app()->instance('request', Request::create('/api/product/999999', 'GET'));

    (new $controllerClass())->show(999999);
})->throws(\Illuminate\Database\Eloquent\ModelNotFoundException::class);

it('honors an explicit ?limit= under the cap, and still reports the real total', function () {
    [$rows, $total] = controllerIndexFor('api/product', ['limit' => 2]);

    expect($rows)->toHaveCount(2);
    expect($total)->toBe(5);
});

it('clamps an explicit ?limit= over the cap down to the cap', function () {
    config(['vifrost.max_limit' => 3]);

    [$rows, $total] = controllerIndexFor('api/product', ['limit' => 999]);

    expect($rows)->toHaveCount(3);
    expect($total)->toBe(5);
});

it('shifts the result window with ?offset= without the total changing', function () {
    [$firstPage, $firstTotal] = controllerIndexFor('api/product', ['limit' => 2, 'offset' => 0]);
    [$secondPage, $secondTotal] = controllerIndexFor('api/product', ['limit' => 2, 'offset' => 2]);

    expect($firstPage->pluck('id')->all())->not->toEqual($secondPage->pluck('id')->all());
    expect($firstTotal)->toBe(5);
    expect($secondTotal)->toBe(5);
});

it('paginates a nested relation collection the same way as a flat index', function () {
    [$rows, $total] = controllerIndexFor(
        'api/category/' . $this->category->id . '/products',
        ['limit' => 2]
    );

    expect($rows)->toHaveCount(2);
    expect($total)->toBe(5);
});

it('returns everything unbounded for a model configured as exempt, but still reports the real total', function () {
    config(['vifrost.max_limit_per_model' => ['App\Models\Product' => null]]);

    [$rows, $total] = controllerIndexFor('api/product');

    expect($rows)->toHaveCount(5);
    expect($total)->toBe(5);
});

it('rejects ?offset= with a 422 when given without ?limit= for a model exempt from pagination', function () {
    config(['vifrost.max_limit_per_model' => ['App\Models\Product' => null]]);

    expect(fn() => controllerIndexFor('api/product', ['offset' => 2]))
        ->toThrow(function (HttpException $e) {
            expect($e->getStatusCode())->toBe(422);
        });
});

it('still honors ?offset= for an exempt model when ?limit= is given explicitly alongside it', function () {
    config(['vifrost.max_limit_per_model' => ['App\Models\Product' => null]]);

    [$rows, $total] = controllerIndexFor('api/product', ['limit' => 2, 'offset' => 2]);

    expect($rows)->toHaveCount(2);
    expect($total)->toBe(5);
});

it('getCountForPagination() reports the true total even when called after limit()/offset() were applied', function () {
    app()->instance('request', Request::create('/api/product', 'GET', ['limit' => 2, 'offset' => 2]));

    $queryBuilder = QueryBuilder::for((new Vifrost)->getQuery())
        ->allowedFilters([])->allowedIncludes([])->allowedSorts(['id'])
        ->limit(2)->offset(2);

    expect($queryBuilder->toBase()->getCountForPagination())->toBe(5);
});

it('unlike getCountForPagination(), a plain ->count() silently returns 0 once ?offset= is beyond 0', function () {
    app()->instance('request', Request::create('/api/product', 'GET', ['limit' => 2, 'offset' => 2]));

    $queryBuilder = QueryBuilder::for((new Vifrost)->getQuery())
        ->allowedFilters([])->allowedIncludes([])->allowedSorts(['id'])
        ->limit(2)->offset(2);

    // Why the stub reaches for getCountForPagination() instead of the obvious
    // ->count(): a COUNT(*) query has exactly one result row, so any already-applied
    // ?offset= beyond 0 skips that row entirely — this returns 0, not the total, not
    // even the page size.
    expect($queryBuilder->count())->toBe(0);
});
