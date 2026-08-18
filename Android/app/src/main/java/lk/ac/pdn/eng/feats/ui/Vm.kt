package lk.ac.pdn.eng.feats.ui

import androidx.lifecycle.AndroidViewModel
import lk.ac.pdn.eng.feats.AttendanceApp
import lk.ac.pdn.eng.feats.AppContainer

/** Convenience accessor for the app's service-locator container from any AndroidViewModel. */
val AndroidViewModel.container: AppContainer
    get() = (getApplication() as AttendanceApp).container
