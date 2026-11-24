package com.looklancare.app.enrollment

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class FaceScanViewManager : SimpleViewManager<FaceScanView>() {
  override fun getName() = "LookLanFaceScan"
  override fun createViewInstance(context: ThemedReactContext) = FaceScanView(context)
  @ReactProp(name = "pose") fun setPose(view: FaceScanView, value: String?) { view.setPose(value ?: "all") }
  @ReactProp(name = "facing") fun setFacing(view: FaceScanView, value: String?) { view.setFacing(value ?: "front") }
  @ReactProp(name = "scanEnabled", defaultBoolean = true) fun setEnabled(view: FaceScanView, value: Boolean) { view.setEnabledScan(value) }
  @ReactProp(name = "restartToken") fun setRestartToken(view: FaceScanView, value: Int) { view.setRestartToken(value) }
  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> = mapOf(
    "topScanState" to mapOf("registrationName" to "onScanState"),
    "topScanCapture" to mapOf("registrationName" to "onScanCapture"))
  override fun onDropViewInstance(view: FaceScanView) { view.dispose(); super.onDropViewInstance(view) }
}
