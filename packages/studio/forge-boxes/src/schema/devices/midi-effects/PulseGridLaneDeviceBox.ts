import {BoxSchema} from "@opendaw/lib-box-forge"
import {Pointers} from "@opendaw/studio-enums"
import {DeviceFactory} from "../../std/DeviceFactory"
import {UnipolarConstraints} from "../../std/Defaults"

export const PulseGridLaneDeviceBox: BoxSchema<Pointers> = DeviceFactory.createMidiEffect("PulseGridLaneDeviceBox", {
    10: {type: "pointer", name: "grid", pointerType: Pointers.PulseGrid, mandatory: true},
    11: {type: "int32", name: "kind", value: 0, constraints: {values: [0, 1]}, unit: ""},
    12: {type: "int32", name: "pitch", value: 60, constraints: {min: 0, max: 127}, unit: ""},
    13: {type: "float32", name: "probability", value: 1, ...UnipolarConstraints},
    14: {type: "float32", name: "humanize", value: 0, ...UnipolarConstraints},
    15: {type: "boolean", name: "accent", value: true},
    16: {type: "int32", name: "group", value: 0, constraints: "any", unit: ""},
    17: {type: "int32", name: "hue", value: 0, constraints: "any", unit: ""},
    18: {type: "boolean", name: "armed", value: false},
    19: {type: "int32", name: "seed", value: 0, constraints: "any", unit: ""},
    30: {
        type: "array", name: "patterns", length: 64, element: {
            type: "object", class: {
                name: "PulseGridPattern", fields: {
                    1: {type: "int32", name: "length", value: 0, constraints: {min: 0, max: 64}, unit: ""},
                    2: {type: "bytes", name: "notes"}
                }
            }
        }
    }
})
