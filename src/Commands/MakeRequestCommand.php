<?php

namespace Vifrost\Laravel\Commands;

use Vifrost\Laravel\Commands\VifrostCommand;
use Vifrost\Laravel\Describer;
use Vifrost\Laravel\FormRequest\ValidationGenerator;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputOption;


class MakeRequestCommand extends VifrostCommand
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'vifrost:request {name} {model} {--force}';

    /**
	 * The name and signature of the console command.
	 *
	 * @var string
	 */
    protected $name = 'vifrost:request';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Creates a new Form Request';


    /**
	 * The type of class being generated.
	 *
	 * @var string
	 */
    protected $type = 'Request';

    protected function getCodeToReplace(){
        $model = $this->getModel();
        return [
            "rules" => $this->getRulesCode( $model ),
        ];
    }


    protected function getRulesCode( $model ){
        $modelInstance = new $model;
        $description = Describer::describe( $modelInstance );
        $rules = "";
        $count = 0;
        foreach ($description as $column => $columnDescription) {
            if( $this->shouldBeIgnored($modelInstance->getTable(), $column) ){ continue; }
            if( $columnDescription["isPrimaryKey"] ){ continue; }

            $lineBreak="\n            "; 

            if( $count == 0){ $lineBreak = ""; }

            $columnRules = (new ValidationGenerator)->generate($columnDescription);
            $rules = $rules . $lineBreak ."'{$column}' => '{$columnRules}',";
            $count ++;
        }
        return $rules;
    }

	/**
	 * Get the stub file for the generator.
	 *
	 * @return string
	 */
	protected function getStub()
	{
		return  dirname( dirname(__FILE__) ).'/Stubs/Request.stub';
	}

	/**
	 * Get the default namespace for the class.
	 *
	 * @param  string  $rootNamespace
	 * @return string
	 */
	protected function getDefaultNamespace($rootNamespace)
	{
		return $rootNamespace . '\Http\Requests';
	}

    /**
     * Get the console command arguments.
     *
     * @return array
     */
    protected function getArguments()
    {
        return [
            ['model', InputArgument::REQUIRED, 'The model to generate request.'],
            ['name', InputArgument::REQUIRED, 'The name to generate request.'],
        ];
    }

    /**
     * Get the console command options.
     *
     * @return array
     */
    protected function getOptions()
    {
        return [
            ['force', null, InputOption::VALUE_NONE, 'Create the abstract class even if it already exists'],
        ];
    }


    protected function getModel(){
        $modelName = $this->argument("model");
        return "App\\Models\\".$modelName;   
    }

    /**
     * Check if a given column is ignored by user config
     * 
     * @param string $table database table name
     * @param string $column database table column
     * @return boolean
     */
    protected function shouldBeIgnored( string $table, string $column){
        $ignored = config('vifrost.ignored_columns');
        return in_array("*.$column", $ignored) || in_array("$table.$column", $ignored);
    }
}