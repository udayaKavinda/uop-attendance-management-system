package lk.ac.pdn.eng.attendance.ui

import androidx.lifecycle.AndroidViewModel
import lk.ac.pdn.eng.attendance.AttendanceApp
import lk.ac.pdn.eng.attendance.AppContainer

/** Convenience accessor for the app's service-locator container from any AndroidViewModel. */
val AndroidViewModel.container: AppContainer
    get() = (getApplication() as AttendanceApp).container
