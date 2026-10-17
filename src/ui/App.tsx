import { navigate, useRoute } from './router';
import Gyms from './screens/Gyms';
import Home from './screens/Home';
import Picker from './screens/Picker';
import Session from './screens/Session';

function Placeholder({ name }: { name: string }) {
  return (
    <main className="screen">
      <header className="bar">
        <button className="btn btn-ghost btn-small" onClick={() => navigate({ name: 'home' })}>
          ‹ Home
        </button>
        <h1 className="title">{name}</h1>
      </header>
    </main>
  );
}

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
    default:
      return <Placeholder name={route.name} />;
  }
}
