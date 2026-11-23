import Workbench from './Workbench';
import '../views/flow/orderFlowView.css';
import '../views/flow/tradeOrderQuestion.css';
import './workbench.css';

/**
 * Stanowisko jako widok aplikacji (`#stanowisko`): ta sama powłoka co reszta (szyna, nagłówek z ceną, pasek dnia, motyw),
 * a w treści stół warsztatowy z wykresami, księgą i nagraniami. Style Stanowiska biorą tokeny motywu aplikacji.
 */
export default function StanowiskoView() {
  return <Workbench embedded />;
}
