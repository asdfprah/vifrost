<?php

namespace Vifrost\Laravel\Tests\Fixtures\ExcludableModels;

use Illuminate\Database\Eloquent\Relations\Pivot;

/**
 * Exists only for ModelsScopeTest, never used against a real database table.
 */
class VisibleInternal extends Pivot
{
}
