<?php

use Vifrost\Laravel\Providers\VifrostServiceProvider;
use Vifrost\Laravel\Tests\Fixtures\SyncModels\Board;
use Vifrost\Laravel\Tests\Fixtures\SyncModels\Ticket;
use Vifrost\Laravel\Vifrost;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

require_once __DIR__ . '/../Support/SyncControllers.php';

/**
 * Rejects every request without an X-Sync-Token header, standing in for an auth middleware.
 */
class RequireSyncToken
{
    /**
     * @param \Illuminate\Http\Request $request
     * @param \Closure $next
     * @return mixed
     */
    public function handle(Request $request, Closure $next)
    {
        abort_unless($request->hasHeader('X-Sync-Token'), 401);
        return $next($request);
    }
}

/**
 * Posts a sync request for the given queries.
 *
 * @param array $queries each { path, known }
 * @return \Illuminate\Testing\TestResponse
 */
function syncQueries(array $queries)
{
    return test()->postJson('/api/_vifrost/sync', ['queries' => $queries], ['X-Sync-Token' => 'yes']);
}

beforeEach(function () {
    config([
        'vifrost.models_path' => 'SyncModels',
        'vifrost.max_limit' => 100,
        'vifrost.sync_route.middleware' => [RequireSyncToken::class],
        'vifrost.sync_route.max_queries' => 3,
    ]);
    Vifrost::syncRoute();

    Schema::dropIfExists('tickets');
    Schema::dropIfExists('boards');
    Schema::create('boards', function (Blueprint $table) {
        $table->id();
    });
    Schema::create('tickets', function (Blueprint $table) {
        $table->id();
        $table->foreignId('board_id')->constrained();
        $table->string('title');
        $table->string('status');
        $table->boolean('archived')->default(false);
    });

    $this->board = Board::create([]);
    $other = Board::create([]);
    foreach ([['a', 'open'], ['b', 'open'], ['c', 'closed'], ['d', 'open']] as [$title, $status]) {
        Ticket::create(['board_id' => $this->board->id, 'title' => $title, 'status' => $status]);
    }
    Ticket::create(['board_id' => $this->board->id, 'title' => 'z', 'status' => 'open', 'archived' => true]);
    Ticket::create(['board_id' => $other->id, 'title' => 'e', 'status' => 'open']);
});

it('returns the page keys and total, with rows only for keys the client does not have', function () {
    $result = syncQueries([['path' => 'ticket?sort=title&limit=2', 'known' => [1]]])->assertOk()->json('results.0');

    expect($result['status'])->toBe(200)
        ->and($result['ids'])->toBe([1, 2])
        ->and($result['total'])->toBe(5)
        ->and(array_column($result['rows'], 'title'))->toBe(['b']);
});

it('runs the controller query(), with its customizations, filters and pagination', function () {
    $result = syncQueries([['path' => 'ticket?filter[status]=open&limit=2&offset=2', 'known' => []]])->json('results.0');

    expect($result['ids'])->toBe([4, 6])
        ->and($result['total'])->toBe(4);
});

it('syncs a nested relation through the related model controller', function () {
    $result = syncQueries([['path' => "board/{$this->board->id}/tickets?limit=10", 'known' => []]])->json('results.0');

    expect($result['ids'])->toBe([1, 2, 3, 4])
        ->and($result['total'])->toBe(4);
});

it('reports a failing query in its own entry without failing the others', function () {
    $results = syncQueries([
        ['path' => 'ticket?filter[title]=a', 'known' => []],
        ['path' => 'board/999/tickets', 'known' => []],
        ['path' => 'ticket?limit=1', 'known' => []],
    ])->assertOk()->json('results');

    expect(array_column($results, 'status'))->toBe([400, 404, 200]);
});

it('rejects paths that are not a collection query or name no exposed model', function (string $path) {
    expect(syncQueries([['path' => $path, 'known' => []]])->json('results.0.status'))->toBe(404);
})->with(['ticket/1', 'board/1/tickets/1', 'nothing']);

it('reports 501 for a controller without query(), so the client refetches instead', function () {
    expect(syncQueries([['path' => 'board?limit=10', 'known' => []]])->json('results.0.status'))->toBe(501);
});

it('limits how many queries one request syncs', function () {
    syncQueries(array_fill(0, 4, ['path' => 'ticket', 'known' => []]))->assertStatus(422);
});

it('runs the configured middleware', function () {
    test()->postJson('/api/_vifrost/sync', ['queries' => [['path' => 'ticket']]])->assertStatus(401);
});

it('is not registered unless enabled', function (bool $enabled) {
    Route::setRoutes(new \Illuminate\Routing\RouteCollection);
    config(['vifrost.sync_route.enabled' => $enabled]);
    (new VifrostServiceProvider(app()))->boot();

    $match = fn () => app('router')->getRoutes()->match(Request::create('/api/_vifrost/sync', 'POST'));

    $enabled ? expect($match())->not->toBeNull() : expect($match)->toThrow(NotFoundHttpException::class);
})->with(['disabled' => false, 'enabled' => true]);

it('guards the schema route with its configured middleware', function () {
    config([
        'vifrost.expose_schema_route' => true,
        'vifrost.schema_route_middleware' => [RequireSyncToken::class],
    ]);
    (new VifrostServiceProvider(app()))->boot();

    test()->getJson('/api/_schema')->assertStatus(401);
});
