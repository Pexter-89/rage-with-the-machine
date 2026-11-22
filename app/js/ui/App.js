import { useRoute } from './router.js';
import ExerciseEdit from './screens/ExerciseEdit.js';
import GymDetail from './screens/GymDetail.js';
import Gyms from './screens/Gyms.js';
import Home from './screens/Home.js';
import Logging from './screens/Logging.js';
import Picker from './screens/Picker.js';
import Progress from './screens/Progress.js';
import Session from './screens/Session.js';
import Settings from './screens/Settings.js';
import { html } from '../lib/html.js';

export default function App() {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return html`<${Home} />`;
    case 'gyms':
      return html`<${Gyms} />`;
    case 'session':
      return html`<${Session} sessionId=${route.sessionId} />`;
    case 'pick':
      return html`<${Picker} sessionId=${route.sessionId} />`;
    case 'log':
      return html`<${Logging} key=${`${route.sessionId}/${route.key}`} sessionId=${route.sessionId} itemKey=${route.key} />`;
    case 'settings':
      return html`<${Settings} />`;
    case 'progress':
      return html`<${Progress} />`;
    case 'gym':
      return html`<${GymDetail} key=${route.gymId} gymId=${route.gymId} />`;
    case 'exercise':
      return html`
        <${ExerciseEdit}
          key=${`${route.gymId}/${route.geId}/${route.catalogId ?? ''}`}
          gymId=${route.gymId}
          geId=${route.geId}
          catalogId=${route.catalogId}
        />
      `;
  }
}
