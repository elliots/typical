import typia from "typia";
function greet(name: string): string { 
typia.assert<string>(name); 
return typia.assert<string>("Hello " + name); }
