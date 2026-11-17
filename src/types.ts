export type PaymentMethod = 'dinheiro' | 'pix' | 'debito' | 'credito';
export type TransactionType = 'entrada' | 'saida';
export type UserRole = 'owner' | 'manager' | 'barber';
export type PrivateRecordType = 'reserva' | 'pro_labore' | 'investimento' | 'nota';
export type BillingCycle = 'semanal' | 'quinzenal' | 'mensal';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

export interface ServiceItem {
  id: string;
  name: string;
  category: string;
  price: number;
  durationMin: number;
  active: boolean;
  createdAt: string;
}

export interface Appointment {
  id: string;
  serviceId: string;
  serviceName: string;
  barberName: string;
  clientName: string;
  amount: number;
  date: string;
  time: string;
  paymentMethod: PaymentMethod;
  notes: string;
  transactionId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  category: string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  date: string;
  time: string;
  appointmentId: string | null;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CashClosing {
  id: string;
  date: string;
  openingBalance: number;
  totalReceived: number;
  totalCash: number;
  totalPix: number;
  totalDebit: number;
  totalCredit: number;
  totalCard: number;
  totalExpenses: number;
  finalBalance: number;
  countedCash: number | null;
  appointmentsCount: number;
  notes: string;
  closedBy: string;
  closedAt: string;
}

export interface PrivateRecord {
  id: string;
  title: string;
  type: PrivateRecordType;
  amount: number;
  date: string;
  details: string;
  createdAt: string;
}

export interface MembershipPlan {
  id: string;
  name: string;
  description: string;
  includedServices: string[];
  cycle: BillingCycle;
  price: number;
  active: boolean;
  isTemplate: boolean;
  createdAt: string;
}

export interface Subscriber {
  id: string;
  clientName: string;
  clientPhone: string;
  planId: string;
  planName: string;
  includedServices: string;
  cycle: BillingCycle;
  amount: number;
  paymentMethod: PaymentMethod;
  nextDueDate: string;
  lastPaidAt: string | null;
  status: 'ativo' | 'pausado';
  notes: string;
  createdAt: string;
}

export interface AppSettings {
  shopName: string;
  openingCashBalance: number;
  dailyGoal: number;
  monthlyGoal: number;
  cloudSyncEnabled: boolean;
  cloudSyncUrl: string;
  lastBackupAt: string | null;
  pixKey: string;
  pixHolderName: string;
  pixCity: string;
}

export interface AppBootstrapPayload {
  user: User;
  settings: AppSettings;
  services: ServiceItem[];
  appointments: Appointment[];
  transactions: Transaction[];
  cashClosings: CashClosing[];
  membershipPlans: MembershipPlan[];
  subscribers: Subscriber[];
  users?: User[];
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  debito: 'Débito',
  credito: 'Crédito',
};

export const CYCLE_LABELS: Record<BillingCycle, string> = {
  semanal: 'Semanal',
  quinzenal: 'Quinzenal',
  mensal: 'Mensal',
};

export const INCOME_CATEGORIES = [
  'Serviços de Barbearia',
  'Planos / Assinaturas',
  'Venda de Produtos',
  'Outros Recebimentos',
];

export const EXPENSE_CATEGORIES = [
  'Produtos e Insumos',
  'Aluguel e Condomínio',
  'Energia, Água e Internet',
  'Comissões de Barbeiros',
  'Manutenção e Equipamentos',
  'Marketing e Divulgação',
  'Impostos e Taxas',
  'Outras Despesas',
];

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  barber: 'Barbeiro',
};

export const PRIVATE_TYPE_LABELS: Record<PrivateRecordType, string> = {
  reserva: 'Reserva / Cofre',
  pro_labore: 'Pró-Labore',
  investimento: 'Investimento',
  nota: 'Nota Confidencial',
};
