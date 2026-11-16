import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import Dialog from 'primevue/dialog'
import Tag from 'primevue/tag'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
import Skeleton from 'primevue/skeleton'
import ProgressSpinner from 'primevue/progressspinner'
import App from './App.vue'
import router from './router'
import './styles.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: false } } })
app.use(ToastService)
app.use(ConfirmationService)

for (const [name, component] of Object.entries({ Button, InputText, Password, Select, Textarea, Dialog, Tag, Toast, ConfirmDialog, Skeleton, ProgressSpinner })) {
  app.component(name, component)
}

app.mount('#app')
