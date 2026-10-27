<?php

namespace Vifrost\Laravel\FormRequest;

class ValidationGenerator{
    private string $rules;

    public function __construct(){
        $this->rules = "";
    }
    
    private function addRule(string $rule){
        strlen($this->rules) == 0 ? $this->rules = $this->rules.$rule : $this->rules =$this->rules."|{$rule}";
    }

    public function generate($description){
        $this->addRequiredRule( !$description["isNullable"] && !$description["hasDefaultValue"] && !$description["hasAutoIncrement"] );
        $this->addNullableRule( $description["isNullable"] );
        $this->addTypeRule($description["type"], $description["rawType"] ?? $description["type"]);
        $this->addLengthRule( $description["length"] );
        if($description["isForeign"]){
            $this->addExistsRule($description["foreign"]);
        }
        return $this->rules;
    }

    private function addExistsRule($foreign){
        $table = $foreign->foreignTable;
        $column = $foreign->foreignColumn;
        $this->addRule("exists:{$table},{$column}");
    }

    private function addLengthRule($length){
        $length = $length ?? 0;
        if($length == 0){
            return;
        }
        $this->addRule("max:{$length}");
    }

    private function addRequiredRule( bool $isRequired ){
        if(!$isRequired){
            return;
        }
        $this->addRule("required");
    }

    /**
     * Lets a nullable column be cleared by sending null, instead of validating null against its type rule
     *
     * @param bool $isNullable
     */
    private function addNullableRule( bool $isNullable ){
        if(!$isNullable){
            return;
        }
        $this->addRule("nullable");
    }

    /**
     * Maps a database column type to a Laravel validation rule.
     *
     * Native type names aren't consistent across drivers: MySQL/SQLite report SQL-ish
     * names ("bigint", "smallint", "double"), while Postgres reports its own internal
     * aliases ("int8", "int2", "float8", "bool") for the very same kind of column. Both
     * families are listed here side by side.
     *
     * @param string $type base type name reported by the DB driver (e.g. "varchar", "int8")
     * @param string $rawType full type definition (e.g. "tinyint(1)"), used to tell a MySQL
     *   boolean (tinyint(1)) apart from an actual small integer column (tinyint(3), etc.)
     */
    private function addTypeRule(string $type, string $rawType = ''){
        switch ($type) {
            case 'bigint':
            case 'int':
            case 'integer':
            case 'mediumint':
            case 'int2':
            case 'int4':
            case 'int8':
            case 'year':
                $this->addRule("integer");
                break;
            case 'tinyint':
            case 'bit':
                $this->addRule( str_contains($rawType, '(1)') ? "boolean" : "integer" );
                break;
            case 'binary':
            case 'varbinary':
            case 'blob':
            case 'tinyblob':
            case 'mediumblob':
            case 'longblob':
                break;
            case 'boolean':
            case 'bool':
                $this->addRule("boolean");
                break;
            case 'date':
                $this->addRule("date");
                break;
            case 'datetime':
            case 'timestamp':
            case 'timestamptz':
                $this->addRule("date");
                break;
            case 'decimal':
            case 'numeric':
                $this->addRule("numeric");
                break;
            case 'float':
            case 'double':
            case 'float4':
            case 'float8':
                $this->addRule("numeric");
                break;
            case 'smallint':
                $this->addRule("integer");
                break;
            case 'char':
            case 'bpchar':
            case 'varchar':
            case 'string':
            case 'set':
                $this->addRule("string");
                break;
            case 'text':
            case 'mediumtext':
            case 'longtext':
                $this->addRule("string");
                break;
            case 'time':
            case 'timetz':
                $this->addRule("date_format:H:i,H:i:s");
                break;
            case 'json':
            case 'jsonb':
                $this->addRule("array");
                break;
            case 'enum':
                $this->addRule("string");
                break;
            case 'uuid':
                $this->addRule("uuid");
                break;
        }
    }
}