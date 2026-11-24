package com.looklancare.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.looklancare.app.enrollment.FaceScanViewManager

class BackgroundMonitoringPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(BackgroundMonitoringModule(reactContext), FaceEnrollmentModule(reactContext), VideoFallTestModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(FaceScanViewManager())
}
