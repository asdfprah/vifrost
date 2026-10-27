<?php

use Vifrost\Laravel\Vifrost;
use Illuminate\Support\Facades\Artisan;

describe('ModelsScopeTest', function () {
    it('scopes the scan to config(vifrost.models_path) instead of the whole app_path()', function () {
        config(['vifrost.models_path' => 'ScopedModels']);

        $models = (new Vifrost)->models();

        expect($models->map(fn($m) => class_basename($m))->all())->toBe(['DummyScopedModel']);
    });

    it('leaves out Pivot subclasses by default', function () {
        config(['vifrost.models_path' => 'ExcludableModels']);

        expect((new Vifrost)->models()->map(fn($m) => class_basename($m))->sort()->values()->all())
            ->toBe(['Internal', 'Visible']);
    });

    it('keeps Pivot subclasses when exclude_pivots is false', function () {
        config(['vifrost.models_path' => 'ExcludableModels', 'vifrost.exclude_pivots' => false]);

        expect((new Vifrost)->models()->map(fn($m) => class_basename($m))->sort()->values()->all())
            ->toBe(['Internal', 'Visible', 'VisibleInternal']);
    });

    it('leaves out the models listed in exclude_models, with or without a leading backslash', function (string $prefix) {
        $excluded = $prefix . 'Vifrost\\Laravel\\Tests\\Fixtures\\ExcludableModels\\Internal';
        config(['vifrost.models_path' => 'ExcludableModels', 'vifrost.exclude_models' => [$excluded]]);

        expect((new Vifrost)->models()->map(fn($m) => class_basename($m))->all())->toBe(['Visible']);
    })->with(['without backslash' => '', 'with backslash' => '\\']);

    it('vifrost:cache leaves out excluded models too', function () {
        config(['vifrost.models_path' => 'ExcludableModels', 'vifrost.exclude_models' => ['Vifrost\\Laravel\\Tests\\Fixtures\\ExcludableModels\\Internal']]);
        $cachePath = app()->bootstrapPath(Vifrost::MODELS_CACHE_PATH);

        try {
            Artisan::call('vifrost:cache');
            $cached = require $cachePath;
        } finally {
            @unlink($cachePath);
        }

        expect(array_map('class_basename', $cached))->toBe(['Visible']);
    });

    it('returns an empty collection instead of throwing when the configured models_path does not exist', function () {
        config(['vifrost.models_path' => 'NoSuchDirectory']);

        expect((new Vifrost)->models())->toBeEmpty();
    });

    it('reads from the models cache file instead of scanning, when vifrost:cache wrote one', function () {
        $cachePath = app()->bootstrapPath(Vifrost::MODELS_CACHE_PATH);
        @mkdir(dirname($cachePath), 0777, true);
        file_put_contents($cachePath, "<?php\nreturn ['\\\\Some\\\\Cached\\\\Model'];\n");

        try {
            $models = (new Vifrost)->models();
        } finally {
            @unlink($cachePath);
        }

        expect($models->all())->toBe(['\Some\Cached\Model']);
    });

    it('vifrost:cache writes a working cache file that vifrost:clear removes', function () {
        config(['vifrost.models_path' => 'ScopedModels']);
        $cachePath = app()->bootstrapPath(Vifrost::MODELS_CACHE_PATH);
        @unlink($cachePath);

        try {
            Artisan::call('vifrost:cache');

            expect(file_exists($cachePath))->toBeTrue();
            expect(collect(require $cachePath)->map(fn($m) => class_basename($m))->all())
                ->toBe(['DummyScopedModel']);

            config(['vifrost.models_path' => 'NoSuchDirectory']);
            expect((new Vifrost)->models())->not->toBeEmpty();

            Artisan::call('vifrost:clear');

            expect(file_exists($cachePath))->toBeFalse();
        } finally {
            @unlink($cachePath);
        }
    });
});
