import type { Metadata } from 'next';
import { readFloorService } from '@/lib/db/floor-service';
import { FLOOR_ROLES, getStaffContext } from '@/lib/db/staff';
import { FloorServiceScreen } from '@/components/screens/FloorServiceScreen';

export const metadata: Metadata = { title: 'Floor service · AutoDine', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function WaiterPage() {
  const staff = await getStaffContext();
  const authorized = staff && FLOOR_ROLES.includes(staff.role) ? staff : null;
  const data = authorized ? await readFloorService(authorized) : null;
  return <FloorServiceScreen key={authorized?.restaurantId} data={data} outlet={authorized?.restaurantId}
    name={authorized?.restaurantName} canTransfer={authorized?.role === 'owner' || authorized?.role === 'manager'} />;
}
