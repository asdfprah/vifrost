<?php

namespace Vifrost\Laravel\Tests\Fixtures\CompositeModels;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StaffMember extends Model
{
    protected $table = 'staff_members';
    protected $guarded = [];
    public $timestamps = false;

    public function roles(): HasMany
    {
        return $this->hasMany(StaffMemberRole::class);
    }
}
