<?php

namespace Vifrost\Laravel\Tests\Fixtures\ScopedModels;

use Illuminate\Database\Eloquent\Model;

/**
 * Exists only for ModelsScopeTest — proves Vifrost::models() finds a model placed
 * under config('vifrost.models_path') and nowhere else, and is never used against a
 * real database table.
 */
class DummyScopedModel extends Model
{
}
