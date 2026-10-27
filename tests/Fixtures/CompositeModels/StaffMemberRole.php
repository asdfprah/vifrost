<?php

namespace Vifrost\Laravel\Tests\Fixtures\CompositeModels;

use Illuminate\Database\Eloquent\Model;

class StaffMemberRole extends Model
{
    protected $table = 'staff_member_roles';
    protected $primaryKey = null;
    public $incrementing = false;
    public $timestamps = false;
    protected $guarded = [];
}
