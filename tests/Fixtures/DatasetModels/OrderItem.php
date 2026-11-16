<?php

namespace Vifrost\Laravel\Tests\Fixtures\DatasetModels;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Exists only for DatasetTest.
 */
class OrderItem extends Model
{
    protected $table = 'ds_order_items';
    protected $guarded = [];
    public $timestamps = false;

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany
     */
    public function refunds(): HasMany
    {
        return $this->hasMany(Refund::class);
    }
}
