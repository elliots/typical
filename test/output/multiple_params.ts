import typia from "typia";
const __typical_assert_number = typia.createAssert<number>();
function add(a: number, b: number): number { 
__typical_assert_number(a); 
__typical_assert_number(b); 
return __typical_assert_number(a + b); }
