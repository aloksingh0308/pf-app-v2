import { AppColors } from '@/constants/appColors';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList } from 'react-native';
import { useSelector } from 'react-redux';
import styled from 'styled-components/native';

import { RootState } from '../../store';
import { userService } from '../../services/userService';

type WalletEntry = {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  description: string;
  referenceId?: string;
  balanceAfter?: number;
  createdAt?: any;
};

export default function WalletHistoryScreen() {
  const user = useSelector((state: RootState) => state.auth.user);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<WalletEntry[]>([]);

  useEffect(() => {
    if (!user?.uid) {
      setEntries([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    userService
      .listWalletTransactions()
      .then((rows) => {
        if (!active) return;
        setEntries(rows.map((row) => ({ ...row, id: row._id })));
      })
      .catch(() => {
        if (active) setEntries([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.uid]);

  if (loading) {
    return (
      <Container>
        <Center>
          <ActivityIndicator size="large" color="#f68712" />
        </Center>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <BackButton onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#282939" />
        </BackButton>
        <Title>Wallet History</Title>
        <Spacer />
      </Header>


      {/* --- Reward Coin System UI --- */}
      <RowBox>
        <SideCard>
          <BalanceLabel>Reward Coins</BalanceLabel>
          <BalanceValue>{Number((user as any)?.earnedCoin || 0)}</BalanceValue>
        </SideCard>
        <SideCard style={{ marginRight: 0 }}>
          <BalanceLabel>Wallet Balance</BalanceLabel>
          <BalanceValue>₹{Number(user?.walletBalance || 0).toFixed(2)}</BalanceValue>
        </SideCard>
      </RowBox>
        <BalanceCard style={{ backgroundColor: '#fffbe6', borderColor: '#ffe58f', marginBottom: 16 }}>
          <BalanceLabel style={{ color: '#ad8b00' }}>Coins can be redeemed only on Sunday</BalanceLabel>
        </BalanceCard>
      {/* --- End Reward Coin System UI --- */}
      {entries.length === 0 ? (
        <EmptyText>No wallet transactions yet.</EmptyText>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const isCredit = item.type === 'credit';
            const dateValue = item.createdAt?.toDate?.() || item.createdAt;

            return (
              <TxnCard>
                <TxnTop>
                  <TxnTitle numberOfLines={1}>{item.description || 'Wallet Transaction'}</TxnTitle>
                  <TxnAmount isCredit={isCredit}>{isCredit ? '+' : '-'}₹{Number(item.amount || 0).toFixed(2)}</TxnAmount>
                </TxnTop>
                <TxnMeta>{dateValue ? new Date(dateValue).toLocaleString() : ''}</TxnMeta>
                <TxnMeta>Type: {isCredit ? 'Credit' : 'Debit'}</TxnMeta>
                {typeof item.balanceAfter === 'number' && <TxnMeta>Balance after: ₹{Number(item.balanceAfter).toFixed(2)}</TxnMeta>}
              </TxnCard>
            );
          }}
        />
      )}
    </Container>
  );
}

const RowBox = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin: 16px 16px 0 16px;
`;

const SideCard = styled.View`
  flex: 1;
  border-width: 1px;
  border-color: ${AppColors.lightBorder};
  border-radius: 12px;
  padding: 16px;
  background-color: #fffaf2;
  margin-right: 8px;
`;


const Container = styled.SafeAreaView`
  flex: 1;
  background-color: ${AppColors.background};
`;

const Center = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
`;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  border-bottom-width: 1px;
  border-bottom-color: ${AppColors.border};
  padding-top: 30px;
`;

const Spacer = styled.View`
  width: 40px;
  height: 40px;
`;

const BackButton = styled.TouchableOpacity`
  width: 40px;
  height: 40px;
  justify-content: center;
  align-items: center;
`;

const Title = styled.Text`
  font-size: 20px;
  font-weight: 700;
  color: ${AppColors.textPrimary};
`;

const BalanceCard = styled.View`
  margin: 16px;
  border-width: 1px;
  border-color: ${AppColors.lightBorder};
  border-radius: 12px;
  padding: 16px;
  background-color: #fffaf2;
`;

const BalanceLabel = styled.Text`
  color: ${AppColors.textSecondary};
  font-size: 13px;
`;

const BalanceValue = styled.Text`
  margin-top: 6px;
  color: ${AppColors.primary};
  font-size: 24px;
  font-weight: 700;
`;

const EmptyText = styled.Text`
  text-align: center;
  margin-top: 30px;
  color: ${AppColors.textMuted};
`;

const TxnCard = styled.View`
  border-width: 1px;
  border-color: ${AppColors.lightBorder};
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
  background-color: ${AppColors.white};
`;

const TxnTop = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
`;

const TxnTitle = styled.Text`
  flex: 1;
  color: ${AppColors.textPrimary};
  font-size: 14px;
  font-weight: 600;
  margin-right: 8px;
`;

const TxnAmount = styled.Text<{ isCredit: boolean }>`
  color: ${({ isCredit }: { isCredit: boolean }) => (isCredit ? '#1b8f3a' : '#c62828')};
  font-size: 15px;
  font-weight: 700;
`;

const TxnMeta = styled.Text`
  color: ${AppColors.textMuted};
  font-size: 12px;
  margin-top: 2px;
`;
