<?php

use Vifrost\Laravel\Commands\MakeAPICommand;
use Vifrost\Laravel\Tests\Fixtures\Category;
use Vifrost\Laravel\Tests\Fixtures\Product;
use Illuminate\Support\Facades\File;

function callProtected(object $object, string $method, array $args = [])
{
    $reflection = new ReflectionMethod($object, $method);
    $reflection->setAccessible(true);

    return $reflection->invokeArgs($object, $args);
}

beforeEach(function () {
    $this->tempDir = sys_get_temp_dir() . '/vifrost-make-api-test-' . uniqid();
    mkdir($this->tempDir, recursive: true);
    $this->command = app(MakeAPICommand::class);
});

afterEach(function () {
    array_map('unlink', glob($this->tempDir . '/*'));
    @rmdir($this->tempDir);
});

it('creates routes/api.php with a PHP opening tag when the file does not exist yet', function () {
    $path = $this->tempDir . '/api.php';

    callProtected($this->command, 'ensureApiRoutesFile', [$path]);

    expect(file_exists($path))->toBeTrue();
    expect(file_get_contents($path))->toStartWith('<?php')->not->toContain("\r");
});

it('builds route blocks with LF line endings', function () {
    $routes = callProtected($this->command, 'buildFlatRoutes', ['Product', 'product'])
        . callProtected($this->command, 'buildNestedRoutes', ['\\' . Product::class, 'product', [Category::class]]);

    expect($routes)->toContain("\n")->not->toContain("\r");
});

describe('buildNestedRoutes()', function () {
    it('routes a relation whose model is generated in the same run', function () {
        $routes = callProtected($this->command, 'buildNestedRoutes', ['\\' . Product::class, 'product', [Category::class]]);

        expect($routes)->toContain("Route::get('product/{id}/category', [\\App\\Http\\Controllers\\CategoryController::class, 'index']);");
    });

    it('skips a relation whose model has no controller and is not generated in this run', function () {
        $routes = callProtected($this->command, 'buildNestedRoutes', ['\\' . Product::class, 'product', []]);

        expect($routes)->toBe('');
    });

    it('skips a relation to an excluded model', function () {
        config(['vifrost.exclude_models' => [Category::class]]);
        $command = app(MakeAPICommand::class);

        $routes = callProtected($command, 'buildNestedRoutes', ['\\' . Product::class, 'product', [Category::class]]);

        expect($routes)->toBe('');
    });
});

it('leaves an existing routes/api.php untouched', function () {
    $path = $this->tempDir . '/api.php';
    file_put_contents($path, "<?php\r\n\r\nRoute::get('existing', fn () => null);");

    callProtected($this->command, 'ensureApiRoutesFile', [$path]);

    expect(file_get_contents($path))->toContain("Route::get('existing'");
});

it('registers the api routing entry in bootstrap/app.php when missing', function () {
    $path = $this->tempDir . '/app.php';
    file_put_contents($path, <<<'PHP'
    <?php

    return Application::configure(basePath: dirname(__DIR__))
        ->withRouting(
            web: __DIR__.'/../routes/web.php',
            commands: __DIR__.'/../routes/console.php',
            health: '/up',
        )
        ->create();
    PHP);

    callProtected($this->command, 'ensureApiRoutingRegistered', [$path]);

    expect(file_get_contents($path))->toContain("api: __DIR__.'/../routes/api.php',");
});

it('does not duplicate the api routing entry if already registered', function () {
    $path = $this->tempDir . '/app.php';
    $original = <<<'PHP'
    <?php

    return Application::configure(basePath: dirname(__DIR__))
        ->withRouting(
            web: __DIR__.'/../routes/web.php',
            api: __DIR__.'/../routes/api.php',
            commands: __DIR__.'/../routes/console.php',
            health: '/up',
        )
        ->create();
    PHP;
    file_put_contents($path, $original);

    callProtected($this->command, 'ensureApiRoutingRegistered', [$path]);

    expect(file_get_contents($path))->toBe($original);
});

describe('routesAlreadyExist()', function () {
    it('detects an existing controller group reference for that model only', function () {
        $existing = "Route::controller( '\\App\\Http\\Controllers\\ProductController' )->group( function(){ ... });";

        expect(callProtected($this->command, 'routesAlreadyExist', ['Product', $existing]))->toBeTrue();
        expect(callProtected($this->command, 'routesAlreadyExist', ['Category', $existing]))->toBeFalse();
    });

    it('ignores nested routes of another model that point at this controller', function () {
        $existing = "Route::get('clinic/{id}/products', [\\App\\Http\\Controllers\\ProductController::class, 'index']);";

        expect(callProtected($this->command, 'routesAlreadyExist', ['Product', $existing]))->toBeFalse();
    });

    it('reports no collision for a brand-new routes/api.php', function () {
        expect(callProtected($this->command, 'routesAlreadyExist', ['Product', "<?php\r\n\r\n"]))->toBeFalse();
    });
});

/**
 * vifrost:api regenerates App\Http\Controllers\{Model}Controller (always
 * hardcoded, regardless of this test app's remapped namespace — see
 * Controller.stub) and resolves App\Models\{Model} by the same hardcoded
 * convention. Aliasing both, the same way ControllerIndexTest.php does, lets
 * the real command run against the Fixtures\Product class without a full
 * sandboxed app skeleton on disk.
 *
 * Each Artisan resolution re-runs MakeAPICommand's constructor (which
 * eagerly calls Vifrost::models(), scanning this test app's whole app_path()
 * since models_path is '' here — see TestCase), and that scan stumbles on
 * the real Http/Controllers file the FIRST run just wrote, autoloading it
 * under a second, mismatched guessed name and redeclaring it unless that
 * guessed name is already aliased away — exactly the bug
 * ControllerIndexTest.php's own helper documents and works around.
 */
function aliasProductForRouteCollisionTest(): void
{
    if (! class_exists('App\Http\Controllers\Controller', false)) {
        class_alias(\Illuminate\Routing\Controller::class, 'App\Http\Controllers\Controller');
    }
    if (! class_exists('App\Models\Product', false)) {
        class_alias(Product::class, 'App\Models\Product');
    }
    if (
        class_exists('App\Http\Controllers\ProductController', false)
        && ! class_exists('Vifrost\Laravel\Tests\Fixtures\Http\Controllers\ProductController', false)
    ) {
        // class_alias() warns (not throws) if the alias name is already in
        // use — including by an identical alias another test file already
        // registered for this same process — but Pest/PHPUnit's error
        // handler promotes that warning to a catchable exception, so the
        // guard above is required, not just tidy.
        class_alias(
            'App\Http\Controllers\ProductController',
            'Vifrost\Laravel\Tests\Fixtures\Http\Controllers\ProductController'
        );
    }
}

describe('vifrost:api route-collision prompt (integration)', function () {
    beforeEach(function () {
        $this->routesPath = base_path('routes/api.php');
        @unlink($this->routesPath);
        File::deleteDirectory(app_path('Http'));
        aliasProductForRouteCollisionTest();
    });

    afterEach(function () {
        @unlink($this->routesPath);
        File::deleteDirectory(app_path('Http'));
    });

    it('asks for confirmation before re-appending routes for an already-routed model, and skips when declined', function () {
        $this->artisan('vifrost:api', ['model' => 'Product'])->run();
        aliasProductForRouteCollisionTest();
        $firstRun = file_get_contents($this->routesPath);
        expect($firstRun)->toContain('ProductController');

        $this->artisan('vifrost:api', ['model' => 'Product'])
            ->expectsConfirmation(
                "Append a new Product route block anyway? This may duplicate or conflict with routes you've since customized.",
                'no'
            )
            ->run();

        expect(file_get_contents($this->routesPath))->toBe($firstRun);
    });

    it('appends anyway when the confirmation is accepted', function () {
        $this->artisan('vifrost:api', ['model' => 'Product'])->run();
        aliasProductForRouteCollisionTest();
        $firstRun = file_get_contents($this->routesPath);

        $this->artisan('vifrost:api', ['model' => 'Product'])
            ->expectsConfirmation(
                "Append a new Product route block anyway? This may duplicate or conflict with routes you've since customized.",
                'yes'
            )
            ->run();

        $secondRun = file_get_contents($this->routesPath);
        expect($secondRun)->not->toBe($firstRun);
        expect(substr_count($secondRun, 'ProductController'))->toBeGreaterThan(substr_count($firstRun, 'ProductController'));
    });

    it('--force appends again without asking', function () {
        $this->artisan('vifrost:api', ['model' => 'Product'])->run();
        aliasProductForRouteCollisionTest();
        $firstRun = file_get_contents($this->routesPath);

        $this->artisan('vifrost:api', ['model' => 'Product', '--force' => true])->run();

        $secondRun = file_get_contents($this->routesPath);
        expect($secondRun)->not->toBe($firstRun);
        expect(substr_count($secondRun, 'ProductController'))->toBeGreaterThan(substr_count($firstRun, 'ProductController'));
    });
});
