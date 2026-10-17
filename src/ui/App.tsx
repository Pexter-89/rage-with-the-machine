import { navigate, useRoute } from './router';
import Gyms from './screens/Gyms';
import Home from './screens/Home';

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
    default:
      return <Placeholder name={route.name} />;
  }
}
