import {BoxSchema, reserveMany} from "@opendaw/lib-box-forge"
import {Pointers} from "@opendaw/studio-enums"
import {UnipolarConstraints} from "./Defaults"

export const PulseGridBox: BoxSchema<Pointers> = {
    type: "box",
    class: {
        name: "PulseGridBox",
        fields: {
            1: {type: "string", name: "label"},
            ...reserveMany(2, 3, 4, 5, 6, 7, 8, 9),
            10: {type: "int32", name: "length", value: 16, constraints: {min: 1, max: 64}, unit: ""},
            11: {type: "float32", name: "swing", value: 50, constraints: {min: 50, max: 75, scaling: "linear"}, unit: "%"},
            12: {type: "float32", name: "groove", value: 0, ...UnipolarConstraints},
            13: {type: "float32", name: "probability", value: 1, ...UnipolarConstraints},
            14: {type: "float32", name: "humanize", value: 0, ...UnipolarConstraints},
            15: {type: "int32", name: "scene", value: 0, constraints: {min: 0, max: 15}, unit: ""},
            16: {type: "int32", name: "variation", value: 0, constraints: {min: 0, max: 3}, unit: ""},
            17: {type: "int32", name: "root", value: 0, constraints: {min: 0, max: 11}, unit: ""},
            18: {type: "int32", name: "scale", value: 0, constraints: "non-negative", unit: ""},
            19: {type: "float32", name: "accent-amount", value: 0.5, ...UnipolarConstraints},
            30: {
                type: "array", name: "scenes", length: 16, element: {
                    type: "object", class: {
                        name: "PulseGridScene", fields: {
                            1: {type: "string", name: "label"},
                            2: {type: "boolean", name: "used"}
                        }
                    }
                }
            }
        }
    },
    pointerRules: {mandatory: true, accepts: [Pointers.PulseGrid]},
    resource: "internal"
}
