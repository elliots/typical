import * as __typia_transform__assertGuard from "typia/lib/internal/_assertGuard.js";
import typia from "typia";
const __typical_assert_number = (() => { const __is = (input: any): input is number => "number" === typeof input; let _errorFactory: any; return (input: any, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): number => {
    if (false === __is(input)) {
        _errorFactory = errorFactory;
        ((input: any, _path: string, _exceptionable: boolean = true) => "number" === typeof input || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.createAssert",
            path: _path + "",
            expected: "number",
            value: input
        }, _errorFactory))(input, "$input", true);
    }
    return input;
}; })();
function checkNum(n: number): number {
        __typical_assert_number(n);
        return n;
}
