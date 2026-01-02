import typia from "typia";
const __typical_assert_string = typia.createAssert<string>();
function greet(name: string): string { 
__typical_assert_string(name); 
return __typical_assert_string("Hello " + name); }
