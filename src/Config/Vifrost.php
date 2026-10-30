<?php

return [
    'ignored_columns' => ['*.created_at', '*.updated_at', '*.deleted_at'],
    'exclude'     => ['api'],

    // Relative to app_path() — where Vifrost::models() looks for Eloquent models.
    'models_path' => 'Models',

    // Models left out of the schema, codegen, vifrost:api all and routing, as full class names.
    'exclude_models' => [
        // \App\Models\User::class,
    ],

    // Leaves out models that extend Illuminate\Database\Eloquent\Relations\Pivot.
    'exclude_pivots' => true,

    // Joins the values of a composite primary key in URLs, e.g. /api/staffmemberrole/5,3.
    'composite_key_separator' => ',',

    'schema_path' => storage_path('app/vifrost-schema.json'),
    'expose_schema_route' => false,
    'schema_route_path'   => 'api/_schema',
    'schema_route_middleware' => [],

    // Endpoint @vifrost/client calls to refresh its lists in one request when records change.
    // Off by default; when off, the client refetches each list instead. Its middleware guards
    // every query it runs, since the route middleware of each query does not run.
    'sync_route' => [
        'enabled' => false,
        'path' => 'api/_vifrost/sync',
        'middleware' => ['api'],
        'max_queries' => 20,
    ],
    'max_limit' => 100,
    'max_limit_per_model' => [
        // \App\Models\Category::class => null,
    ],

    'relations'   => [
        'hasMany',
        'hasOne',
        'belongsTo',
        'belongsToMany',
        'hasOneThrough',
        'hasManyThrough',
        'morphOne',
        'morphMany',
        'morphTo',
        'morphToMany',
        'morphedByMany'
    ],
];
