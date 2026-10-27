<?php

namespace Vifrost\Laravel;

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;
use stdClass;

class Describer{
    /**
     * Returns the raw column description reported by Laravel's native schema introspection
     *
     * @param string $connection database connection name
     * @param string $table database table name
     * @return array
     */
    private static function getColumns(string $connection, string $table):array{
        return Schema::connection($connection)->getColumns($table);
    }

    /**
     * Returns the raw description of a single table column
     *
     * @param string $connection database connection name
     * @param string $table database table name
     * @param string $column database table column
     * @return array
     */
    private static function getColumn(string $connection, string $table, string $column):array{
        foreach (self::getColumns($connection, $table) as $columnData) {
            if($columnData['name'] === $column){
                return $columnData;
            }
        }
        throw new InvalidArgumentException("Column {$column} not found on table {$table}");
    }

    /**
     * Search the foreign key of a given database column, preferring a single-column key over a
     * composite one that also contains the column. The returned key's foreignColumn is the referenced
     * column at the same position as the given local column.
     *
     * @param string $connection database connection name
     * @param string $table database table name
     * @param string $column database table column
     *
     * @return stdClass|null
     */
    public static function getForeignKeysFor( string $connection, string $table , string $column){
        $candidates = array_filter(
            self::getForeignKeys( $connection, $table ),
            fn ($foreign) => in_array( $column , $foreign->localColumn )
        );
        if( empty($candidates) ){
            return null;
        }
        usort($candidates, fn ($a, $b) => count($a->localColumn) <=> count($b->localColumn));
        $foreign = $candidates[0];
        $position = array_search( $column, $foreign->localColumn );
        $foreign->foreignColumn = $foreign->foreignColumnName[$position] ?? null;
        return $foreign;
    }

    /**
     * Retrieves all the foreign keys of a given database table
     *
     * @param string $connection database connection name
     * @param string $table database table name
     * @return array
     */
    public static function getForeignKeys( string $connection, string $table ){
        $foreignDescription =  [];
        $foreignList = Schema::connection( $connection )->getForeignKeys($table);
        foreach ($foreignList as $foreign) {
            $fk = new stdClass();
            $fk->localColumn = $foreign['columns'];
            $fk->foreignTable = $foreign['foreign_table'];
            $fk->foreignColumnName = $foreign['foreign_columns'];
            array_push( $foreignDescription ,$fk );
        }
        return $foreignDescription;
    }

    /**
     * Returns an array with the columns of a given table
     *
     * @param string $tableName database table name
     * @return array
     */
    public static function getTableColumns(  string $connection , string $tableName ):array{
        return Schema::connection( $connection )->getColumnListing( $tableName );
    }


    /**
     * Returns the type of a table column
     *
     * @param string $connection database connection name
     * @param string $table database table name
     * @param string $column database table column
     * @return string
     */
    public static function getTableColumnType( string $connection ,string $table, string $column ):string{
        return self::getColumn($connection, $table, $column)['type_name'];
    }

    /**
     * Check if a given column of a table of a given connection allows NULL values
     *
     * @param string $connection database connection name
     * @param string $table database table name
     * @param string $column database table column
     * @return boolean
     */
    public static function isColumnNullable( string $connection ,string $table, string $column ):bool{
        return (bool) self::getColumn($connection, $table, $column)['nullable'];
    }

    /**
     * Return the character/byte length of a given column, extracted from its native type definition
     * (e.g. "varchar(255)"). Returns null for types where "length" isn't a meaningful concept, such as
     * numeric types with precision/scale (e.g. "decimal(8,2)").
     *
     * @param string $connection database connection name
     * @param string $table database table name
     * @param string $column database table column
     * @return int|null
     */
    public static function getColumnLength( string $connection ,string $table, string $column ){
        $columnData = self::getColumn($connection, $table, $column);
        return self::extractLength($columnData['type_name'], $columnData['type']);
    }

    /**
     * String/binary column types report a meaningful "length" (max chars/bytes). Other types
     * (numeric, date, boolean, etc.) may also have a parenthesized number (precision/scale/display
     * width) that does not represent a length and should not be used to build a "max:" validation rule.
     *
     * @param string $typeName base type name (e.g. "varchar")
     * @param string $type full type definition (e.g. "varchar(255)")
     * @return int|null
     */
    private static function extractLength(string $typeName, string $type){
        $stringTypes = ['char', 'bpchar', 'varchar', 'binary', 'varbinary'];
        if( !in_array( strtolower($typeName) , $stringTypes ) ){
            return null;
        }
        return preg_match('/\((\d+)/', $type, $matches) ? (int) $matches[1] : null;
    }

    /**
     * Return the default value of a given column
     *
     * @param string $connection database connection name
     * @param string $table database table name
     * @param string $column database table column
     * @return mixed
     */
    public static function getDefaultValue( string $connection ,string $table, string $column ){
        return self::normalizeDefault( self::getColumn($connection, $table, $column)['default'] );
    }

    /**
     * Some drivers report a column's default value as raw SQL source rather than a
     * plain scalar:
     * - SQLite/Postgres keep the literal quoting (e.g. "'draft'" instead of "draft").
     * - Postgres also appends an explicit type cast (e.g. "'draft'::character varying").
     * - Postgres reports an auto-increment column's sequence expression as its
     *   "default" (e.g. "nextval('products_id_seq'::regclass)"), which isn't a real
     *   default value — it's already tracked separately via hasAutoIncrement.
     *
     * @param mixed $default
     * @return mixed
     */
    private static function normalizeDefault($default){
        if(!is_string($default)){
            return $default;
        }

        if(str_starts_with($default, 'nextval(')){
            return null;
        }

        $default = preg_replace('/::[a-zA-Z0-9_ ]+$/', '', $default);

        if(strlen($default) >= 2 && $default[0] === "'" && str_ends_with($default, "'")){
            return stripslashes(substr($default, 1, -1));
        }

        return $default;
    }

    /**
     * Check if a given column has an autoincrement
     *
     * @param string $connection database connection name
     * @param string $table database table name
     * @param string $column database table column
     * @return boolean
     */
    public static function hasAutoIncrement( string $connection ,string $table, string $column ):bool{
        return (bool) self::getColumn($connection, $table, $column)['auto_increment'];
    }

    /**
     * Returns the primary key columns of a given model: its Eloquent key name when it has one,
     * otherwise the columns of its table's primary index, which is how a composite key is declared.
     *
     * @param Model $model
     * @return array
     */
    public static function primaryKeyColumns(Model $model):array{
        if( !is_null($model->getKeyName()) ){
            return [$model->getKeyName()];
        }
        $indexes = Schema::connection( $model->getConnection()->getName() )->getIndexes( $model->getTable() );
        foreach ($indexes as $index) {
            if( $index['primary'] ){
                return $index['columns'];
            }
        }
        return [];
    }

    /**
     * Generates a description of the table of a given model
     *
     * @param Model $model Model wich table is gonna be described
     * @return array
     */
    public static function describe(Model $model){
        $description = [];
        $connection = $model->getConnection()->getName();
        $table = $model->getTable();
        $primaryKey = $model->getKeyName();
        foreach (self::getColumns($connection, $table) as $columnData) {
            $column = $columnData['name'];
            $foreign = self::getForeignKeysFor( $connection, $table, $column );
            $defaultValue = self::normalizeDefault($columnData['default']);
            $description[$column] = [
                'type' => $columnData['type_name'],
                'rawType' => $columnData['type'],
                'isPrimaryKey' => $column == $primaryKey,
                'isForeign' => !is_null($foreign),
                'foreign' => $foreign,
                'isNullable' => (bool) $columnData['nullable'],
                'length' => self::extractLength($columnData['type_name'], $columnData['type']),
                'hasDefaultValue' => !is_null($defaultValue),
                'defaultValue' => $defaultValue,
                'hasAutoIncrement' => (bool) $columnData['auto_increment'],
            ];
        }
        return $description;
    }
}
