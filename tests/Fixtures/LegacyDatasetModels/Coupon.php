<?php

namespace Vifrost\Laravel\Tests\Fixtures\LegacyDatasetModels;

use Illuminate\Database\Eloquent\Model;

/**
 * Exists only for LegacyDatasetRulesTest.
 */
class Coupon extends Model
{
    protected $table = 'legacy_coupons';
    protected $guarded = [];
    public $timestamps = false;
}
