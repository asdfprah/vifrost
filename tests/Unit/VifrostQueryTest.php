<?php

use Vifrost\Laravel\Vifrost;
use Vifrost\Laravel\Tests\Fixtures\Category;
use Vifrost\Laravel\Tests\Fixtures\Product;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

beforeEach(function () {
    createTestSchema();

    $this->category = Category::create(['name' => 'Widgets']);
    $this->product = Product::create([
        'category_id' => $this->category->id,
        'name' => 'Gadget',
        'price' => 9.99,
        'status' => 'active',
    ]);
});

function vifrostQueryFor(string $path, array $query = [])
{
    app()->instance('request', Request::create('/' . $path, 'GET', $query));

    return (new Vifrost)->getQuery();
}

it('resolves a nested relation off an existing parent id', function () {
    $query = vifrostQueryFor('api/category/' . $this->category->id . '/products');

    expect($query)->toBeInstanceOf(Relation::class);
});

it('aborts with 404 when the parent id does not exist', function () {
    vifrostQueryFor('api/category/999999/products');
})->throws(NotFoundHttpException::class);

it('resolves a flat show route to a query builder scoped by id', function () {
    $query = vifrostQueryFor('api/product/' . $this->product->id);

    expect($query)->toBeInstanceOf(Builder::class);
});

it('resolves a flat show route whose id is not numeric (e.g. a UUID/ULID primary key)', function () {
    $query = vifrostQueryFor('api/product/01ARZ3NDEKTSV4RRFFQ69G5FAV');

    expect($query)->toBeInstanceOf(Builder::class);
});

it('resolves a flat index route to an unscoped query builder', function () {
    $query = vifrostQueryFor('api/product');

    expect($query)->toBeInstanceOf(Builder::class);
});

it('resolves one record within a nested relation, scoped by its own id', function () {
    $query = vifrostQueryFor('api/category/' . $this->category->id . '/products/' . $this->product->id);

    // Relation::__call() returns $this (not a plain Builder) whenever the forwarded
    // query builder method — here, where() — returns the underlying query builder
    // itself, precisely so the result stays chainable/usable as a Relation.
    expect($query)->toBeInstanceOf(Relation::class);
});

it('resolves a nested show route whose id is not numeric (e.g. a UUID/ULID primary key)', function () {
    $query = vifrostQueryFor('api/category/' . $this->category->id . '/products/01ARZ3NDEKTSV4RRFFQ69G5FAV');

    expect($query)->toBeInstanceOf(Relation::class);
});

it('aborts with 404 for a relation of a relation (more than one hop)', function () {
    vifrostQueryFor('api/category/' . $this->category->id . '/products/' . $this->product->id . '/comments');
})->throws(NotFoundHttpException::class);

// Vifrost::getQuery() only resolves and scopes the query — it never applies limit/
// offset itself. That's the generated controller's job (see Controller.stub's index(),
// exercised end-to-end in ControllerIndexTest.php); these are just sanity checks
it('never applies limit/offset to a flat index, even with ?limit= present', function () {
    $query = vifrostQueryFor('api/product', ['limit' => 1]);

    $sql = strtolower($query->toSql());
    expect($sql)->not->toContain('limit')->not->toContain('offset');
});

it('never applies limit/offset to a nested relation collection, even with ?limit= present', function () {
    $query = vifrostQueryFor('api/category/' . $this->category->id . '/products', ['limit' => 1]);

    $sql = strtolower($query->toSql());
    expect($sql)->not->toContain('limit')->not->toContain('offset');
});
