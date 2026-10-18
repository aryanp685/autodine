import type { DirectionId } from '@/lib/directions';
import { HomeA, HomeB, HomeC } from './screens/HomeScreen';
import { DashboardA, DashboardB, DashboardC } from './screens/DashboardScreen';
import {
  CustomerMenuA,
  CustomerMenuB,
  CustomerMenuC,
  ItemA,
  ItemB,
  ItemC,
} from './screens/CustomerMenu';
import { CartA, CartB, CartC } from './screens/CartScreen';
import { CheckoutA, CheckoutB, CheckoutC } from './screens/CheckoutScreen';
import { KitchenA, KitchenB, KitchenC } from './screens/KitchenScreen';
import { CashierA, CashierB, CashierC } from './screens/CashierScreen';
import { PricingScreen } from './screens/PricingScreen';
import { SignupScreen } from './screens/SignupScreen';
import { MenuEditorScreen } from './screens/MenuEditorScreen';
import { TablesScreen } from './screens/TablesScreen';
import { StatesScreen } from './screens/StatesScreen';

export default function ScreenRenderer({ dir, screen }: { dir: DirectionId; screen: string }) {
  switch (screen) {
    case 'home':
      return dir === 'a' ? <HomeA /> : dir === 'b' ? <HomeB /> : <HomeC />;
    case 'dashboard':
      return dir === 'a' ? <DashboardA /> : dir === 'b' ? <DashboardB /> : <DashboardC />;
    case 'customer-menu':
      return dir === 'a' ? <CustomerMenuA dir={dir} /> : dir === 'b' ? <CustomerMenuB dir={dir} /> : <CustomerMenuC dir={dir} />;
    case 'item':
      return dir === 'a' ? <ItemA dir={dir} /> : dir === 'b' ? <ItemB dir={dir} /> : <ItemC dir={dir} />;
    case 'cart':
      return dir === 'a' ? <CartA dir={dir} /> : dir === 'b' ? <CartB dir={dir} /> : <CartC dir={dir} />;
    case 'checkout':
      return dir === 'a' ? <CheckoutA dir={dir} /> : dir === 'b' ? <CheckoutB dir={dir} /> : <CheckoutC dir={dir} />;
    case 'kitchen':
      return dir === 'a' ? <KitchenA /> : dir === 'b' ? <KitchenB /> : <KitchenC />;
    case 'cashier':
      return dir === 'a' ? <CashierA /> : dir === 'b' ? <CashierB /> : <CashierC />;
    case 'pricing':
      return <PricingScreen />;
    case 'signup':
      return <SignupScreen />;
    case 'menu-editor':
      return <MenuEditorScreen />;
    case 'tables':
      return <TablesScreen />;
    case 'states':
      return <StatesScreen />;
    default:
      return <div style={{ padding: 40 }}>Unknown screen: {screen}</div>;
  }
}
