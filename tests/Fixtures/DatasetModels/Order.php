<?php

namespace Vifrost\Laravel\Tests\Fixtures\DatasetModels;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;

/**
 * Exists only for DatasetTest.
 */
class Order extends Model
{
    protected $table = 'ds_orders';
    protected $guarded = [];
    public $timestamps = false;

    /**
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany
     */
    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\BelongsToMany
     */
    public function watchers(): BelongsToMany
    {
        return $this->belongsToMany(Customer::class, 'ds_order_watchers');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\BelongsToMany
     */
    public function primaryWatchers(): BelongsToMany
    {
        return $this->belongsToMany(Customer::class, 'ds_order_watchers')->wherePivot('is_primary', true);
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasMany
     */
    public function expensiveItems(): HasMany
    {
        return $this->hasMany(OrderItem::class)->where('cost', '>=', 100);
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\HasManyThrough
     */
    public function refunds(): HasManyThrough
    {
        return $this->hasManyThrough(Refund::class, OrderItem::class);
    }
}
