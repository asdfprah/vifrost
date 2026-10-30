<?php

use Vifrost\Laravel\Describer;
use Vifrost\Laravel\SchemaExporter;
use Vifrost\Laravel\Vifrost;
use Vifrost\Laravel\Tests\Fixtures\CompositeModels\StaffMember;
use Vifrost\Laravel\Tests\Fixtures\CompositeModels\StaffMemberRole;
use Vifrost\Laravel\Tests\Fixtures\Product;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Generates the real StaffMemberRole controller and update request, aliasing the App\ names
 * the generators hardcode to this test app's fixtures.
 *
 * @return string generated controller class name
 */
function generatedStaffMemberRoleControllerClass(): string
{
    static $generated = false;

    if (! class_exists('App\Http\Controllers\Controller', false)) {
        class_alias(\Illuminate\Routing\Controller::class, 'App\Http\Controllers\Controller');
    }
    if (! class_exists('App\Models\StaffMemberRole', false)) {
        class_alias(StaffMemberRole::class, 'App\Models\StaffMemberRole');
    }

    if (! $generated) {
        Artisan::call('vifrost:controller', ['model' => 'StaffMemberRole', '--force' => true]);
        Artisan::call('vifrost:request', ['name' => 'UpdateStaffMemberRoleRequest', 'model' => 'StaffMemberRole', '--force' => true]);
        require_once app_path('Http/Requests/UpdateStaffMemberRoleRequest.php');
        class_alias('Vifrost\Laravel\Tests\Fixtures\Http\Requests\UpdateStaffMemberRoleRequest', 'App\Http\Requests\UpdateStaffMemberRoleRequest');
        require_once app_path('Http/Controllers/StaffMemberRoleController.php');
        $generated = true;
    }

    return 'App\Http\Controllers\StaffMemberRoleController';
}

/**
 * @param string $path request path
 * @param string $method HTTP method
 * @return void
 */
function requestTo(string $path, string $method = 'GET'): void
{
    app()->instance('request', Request::create('/' . $path, $method));
}

beforeEach(function () {
    config(['vifrost.models_path' => 'CompositeModels']);

    Schema::dropIfExists('staff_member_roles');
    Schema::dropIfExists('staff_members');

    Schema::create('staff_members', function (Blueprint $table) {
        $table->id();
    });

    Schema::create('staff_member_roles', function (Blueprint $table) {
        $table->foreignId('staff_member_id')->constrained();
        $table->unsignedBigInteger('role_id');
        $table->integer('level');
        $table->primary(['staff_member_id', 'role_id']);
    });

    $this->member = StaffMember::create([]);
    StaffMemberRole::insert([
        ['staff_member_id' => $this->member->id, 'role_id' => 3, 'level' => 1],
        ['staff_member_id' => $this->member->id, 'role_id' => 4, 'level' => 2],
    ]);
});

afterAll(function () {
    File::deleteDirectory(__DIR__ . '/../Fixtures/Http');
});

it('reads composite primary key columns from the primary index', function () {
    expect(Describer::primaryKeyColumns(new StaffMemberRole))->toBe(['staff_member_id', 'role_id'])
        ->and(Describer::primaryKeyColumns(new Product))->toBe(['id']);
});

it('exports a composite primary key as a list of columns, with the separator', function () {
    config(['vifrost.composite_key_separator' => '|']);

    $schema = SchemaExporter::build([StaffMember::class, StaffMemberRole::class]);

    expect($schema['compositeKeySeparator'])->toBe('|')
        ->and($schema['models'][StaffMemberRole::class]['primaryKey'])->toBe(['staff_member_id', 'role_id'])
        ->and($schema['models'][StaffMember::class]['primaryKey'])->toBe('id');
});

it('resolves a record by its composite key values', function () {
    requestTo("api/staffmemberrole/{$this->member->id},4");

    expect((new Vifrost)->getQuery()->first()->level)->toBe(2);
});

it('splits the key with the configured separator', function () {
    config(['vifrost.composite_key_separator' => '|']);
    requestTo("api/staffmemberrole/{$this->member->id}|4");

    expect((new Vifrost)->getQuery()->first()->level)->toBe(2);
});

it('aborts with 404 when the value count does not match the key', function () {
    requestTo("api/staffmemberrole/{$this->member->id}");

    (new Vifrost)->getQuery();
})->throws(NotFoundHttpException::class);

it('resolves a composite child within a nested relation', function () {
    requestTo("api/staffmember/{$this->member->id}/roles/{$this->member->id},3");

    expect((new Vifrost)->getQuery()->first()->level)->toBe(1);
});

it('generates a controller that shows, updates and deletes by composite key', function () {
    $controllerClass = generatedStaffMemberRoleControllerClass();
    $id = "{$this->member->id},3";

    requestTo("api/staffmemberrole/{$id}");
    expect((new $controllerClass())->show($id)->level)->toBe(1);

    $request = new class extends \App\Http\Requests\UpdateStaffMemberRoleRequest {
        public function validated($key = null, $default = null)
        {
            return ['level' => 9];
        }
    };
    requestTo("api/staffmemberrole/{$id}", 'PUT');
    expect((new $controllerClass())->update($request, $id)->level)->toBe(9)
        ->and(StaffMemberRole::where('role_id', 4)->value('level'))->toBe(2);

    requestTo("api/staffmemberrole/{$id}", 'DELETE');
    expect((new $controllerClass())->destroy($id))->toBe(1)
        ->and(StaffMemberRole::count())->toBe(1);
});

it('responds 404 from the generated show() for a missing composite key', function () {
    $controllerClass = generatedStaffMemberRoleControllerClass();
    requestTo("api/staffmemberrole/{$this->member->id},99");

    (new $controllerClass())->show("{$this->member->id},99");
})->throws(ModelNotFoundException::class);

it('syncs a list through the generated controller query(), returning composite keys as value lists', function () {
    generatedStaffMemberRoleControllerClass();
    config(['vifrost.sync_route.middleware' => []]);
    Vifrost::syncRoute();

    $result = $this->postJson('/api/_vifrost/sync', [
        'queries' => [['path' => 'staffmemberrole?limit=10', 'known' => [[$this->member->id, 3]]]],
    ])->json('results.0');

    expect($result['ids'])->toBe([[$this->member->id, 3], [$this->member->id, 4]])
        ->and(array_column($result['rows'], 'role_id'))->toBe([4]);
});
