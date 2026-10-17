import { useRoute } from './router';
import ExerciseEdit from './screens/ExerciseEdit';
import GymDetail from './screens/GymDetail';
import Gyms from './screens/Gyms';
import Home from './screens/Home';
import Logging from './screens/Logging';
import Picker from './screens/Picker';
import Progress from './screens/Progress';
import Session from './screens/Session';
import Settings from './screens/Settings';

export default function App() {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'gyms':
      return <Gyms />;
    case 'session':
      return <Session sessionId={route.sessionId} />;
    case 'pick':
      return <Picker sessionId={route.sessionId} />;
    case 'log':
      return <Logging key={`${route.sessionId}/${route.key}`} sessionId={route.sessionId} itemKey={route.key} />;
    case 'settings':
      return <Settings />;
    case 'progress':
      return <Progress />;
    case 'gym':
      return <GymDetail key={route.gymId} gymId={route.gymId} />;
    case 'exercise':
      return (
        <ExerciseEdit
          key={`${route.gymId}/${route.geId}/${route.catalogId ?? ''}`}
          gymId={route.gymId}
          geId={route.geId}
          catalogId={route.catalogId}
        />
      );
  }
}
