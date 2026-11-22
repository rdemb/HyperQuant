import { createRoot } from 'react-dom/client';
import { lang } from '../i18n';
import Workbench from './Workbench';
import '../index.css';
import '../views/flow/orderFlowView.css';
import '../views/flow/tradeOrderQuestion.css';
import './workbench.css';
import { zainstalujSwiatloSzkla } from '../ui/swiatloSzkla';

zainstalujSwiatloSzkla();

document.documentElement.lang = lang;
createRoot(document.getElementById('workbench-root')!).render(<Workbench />);
