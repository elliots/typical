import * as __typia_transform__assertGuard from "typia/lib/internal/_assertGuard.js";
import * as __typia_transform__jsonStringifyString from "typia/lib/internal/_jsonStringifyString.js";
import typia from "typia";
interface User {
        id: number;
        name: string;
}
function processData(data: User) {
        (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && "string" === typeof input.name; const _ao0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.id || __typia_transform__assertGuard._assertGuard(_exceptionable, {
        method: "typia.assert",
        path: _path + ".id",
        expected: "number",
        value: input.id
    }, _errorFactory)) && ("string" === typeof input.name || __typia_transform__assertGuard._assertGuard(_exceptionable, {
        method: "typia.assert",
        path: _path + ".name",
        expected: "string",
        value: input.name
    }, _errorFactory)); const __is = (input: any): input is User => "object" === typeof input && null !== input && _io0(input); let _errorFactory: any; return (input: any, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): User => {
        if (false === __is(input)) {
            _errorFactory = errorFactory;
            ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || __typia_transform__assertGuard._assertGuard(true, {
                method: "typia.assert",
                path: _path + "",
                expected: "User",
                value: input
            }, _errorFactory)) && _ao0(input, _path + "", true) || __typia_transform__assertGuard._assertGuard(true, {
                method: "typia.assert",
                path: _path + "",
                expected: "User",
                value: input
            }, _errorFactory))(input, "$input", true);
        }
        return input;
    }; })()(data);
        return (() => { const __is = (input: any): input is string => "string" === typeof input; let _errorFactory: any; return (input: any, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): string => {
        if (false === __is(input)) {
            _errorFactory = errorFactory;
            ((input: any, _path: string, _exceptionable: boolean = true) => "string" === typeof input || __typia_transform__assertGuard._assertGuard(true, {
                method: "typia.assert",
                path: _path + "",
                expected: "string",
                value: input
            }, _errorFactory))(input, "$input", true);
        }
        return input;
    }; })()((() => { const _so0 = (input: any): any => `{"id":${input.id},"name":${__typia_transform__jsonStringifyString._jsonStringifyString(input.name)}}`; return (input: User): string => _so0(input); })()(data));
}
const u = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && "string" === typeof input.name; const _ao0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ("number" === typeof input.id || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.assertParse",
    path: _path + ".id",
    expected: "number",
    value: input.id
}, _errorFactory)) && ("string" === typeof input.name || __typia_transform__assertGuard._assertGuard(_exceptionable, {
    method: "typia.json.assertParse",
    path: _path + ".name",
    expected: "string",
    value: input.name
}, _errorFactory)); const __is = (input: any): input is User => "object" === typeof input && null !== input && _io0(input); let _errorFactory: any; const __assert = (input: any, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): User => {
    if (false === __is(input)) {
        _errorFactory = errorFactory;
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.json.assertParse",
            path: _path + "",
            expected: "User",
            value: input
        }, _errorFactory)) && _ao0(input, _path + "", true) || __typia_transform__assertGuard._assertGuard(true, {
            method: "typia.json.assertParse",
            path: _path + "",
            expected: "User",
            value: input
        }, _errorFactory))(input, "$input", true);
    }
    return input;
}; return (input: string, errorFactory?: (p: import("typia").TypeGuardError.IProps) => Error): import("typia").Primitive<User> => __assert(JSON.parse(input), errorFactory) as any; })()('{"id":1,"name":"Alice"}') as User;
processData(u);
