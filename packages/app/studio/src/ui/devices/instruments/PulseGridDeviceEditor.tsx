import css from "./PulseGridDeviceEditor.sass?inline"
import {DeviceHost, InstrumentCompositeBoxAdapter, PulseGridView} from "@opendaw/studio-adapters"
import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {IconSymbol} from "@opendaw/studio-enums"
import {StudioService} from "@/service/StudioService"
import {DeviceEditor} from "@/ui/devices/DeviceEditor"
import {MenuItems} from "@/ui/devices/menu-items"
import {DevicePeakMeter} from "@/ui/devices/panel/DevicePeakMeter"
import {Button} from "@/ui/components/Button"
import {PulseGridContext} from "./PulseGridDeviceEditor/PulseGridContext"
import {PulseGridWindows} from "./PulseGridDeviceEditor/PulseGridWindows"

const className = Html.adoptStyleSheet(css, "PulseGridDeviceEditor")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
    adapter: InstrumentCompositeBoxAdapter
    deviceHost: DeviceHost
}

export const PulseGridDeviceEditor = ({lifecycle, service, adapter, deviceHost}: Construct): HTMLElement => {
    const context = PulseGridContext.create(lifecycle, service, adapter.box)
    const summary: HTMLElement = <span className="summary"/>
    const preview: HTMLElement = <div className="mini-content" aria-hidden="true"/>
    const label: HTMLElement = <h1/>
    const open = (): void => PulseGridWindows.open(service, adapter.box)
    lifecycle.own(context.doc.catchupAndSubscribe(owner => {
        const doc = owner.getValue()
        label.textContent = doc.name
        summary.textContent = `${doc.lanes.length} lanes · scene ${doc.scene} ${doc.variation} · ${doc.settings.length} steps`
        preview.replaceChildren(...doc.lanes.map(lane => {
            const view = PulseGridView.steps(doc, lane)
            return (
                <div className="mini-row" style={{gridTemplateColumns: `repeat(${view.length}, 1fr)`}}
                     title={lane.name}>
                    {view.steps.map(step => <span className={step === undefined ? "" : "lit"}
                                                 style={{color: `hsl(${lane.hue} 98% 60%)`}}/>)}
                </div>
            )
        }))
    }))
    return (
        <DeviceEditor lifecycle={lifecycle} service={service} adapter={adapter}
                      createLabel={() => label}
                      populateMenu={parent => MenuItems.forAudioUnitInput(parent, service, deviceHost)}
                      populateControls={() => (
                          <div className={className}>
                              <div className="heading"><strong>PulseGrid</strong>
                                  <Button lifecycle={lifecycle} className="open" onClick={open}
                                          appearance={{tooltip: "Open PulseGrid"}}><span>Open</span></Button>
                              </div>
                              {summary}
                              <Button lifecycle={lifecycle} className="mini" onClick={open}
                                      appearance={{tooltip: "Open PulseGrid sequencer"}}>{preview}</Button>
                          </div>
                      )}
                      populateMeter={() => (
                          <DevicePeakMeter lifecycle={lifecycle} receiver={service.project.liveStreamReceiver}
                                           address={adapter.address}/>
                      )} icon={IconSymbol.DrumSet}/>
    )
}
