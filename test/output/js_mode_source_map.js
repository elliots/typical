import * as __typia_transform__assertGuard from "typia/lib/internal/_assertGuard.js";
const __typical_assert_number = (() => {
    const __is = (input) => "number" === typeof input;
    let _errorFactory;
    return (input, errorFactory) => {
        if (false === __is(input)) {
            _errorFactory = errorFactory;
            ((input, _path, _exceptionable = true) => "number" === typeof input || __typia_transform__assertGuard._assertGuard(true, {
                method: "typia.createAssert",
                path: _path + "",
                expected: "number",
                value: input
            }, _errorFactory))(input, "$input", true);
        }
        return input;
    };
})();
function checkNum(n) {
    __typical_assert_number(n);
    return n;
}
//# sourceMappingURL=js_mode_source_map.js.map