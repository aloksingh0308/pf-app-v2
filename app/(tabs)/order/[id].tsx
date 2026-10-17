import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import styled from 'styled-components/native';
import { showAlert, showErrorAlert } from '../../../services/alertService';
import { getMyOrders } from '@/services/orderService';
import { orderStatusLabel } from '@/utils/orderStatus';
import { usePolling } from '@/utils/polling';
import { isRateLimited } from '@/utils/apiClient';

const ORDER_POLL_MS = 20_000;

const OrderDetails = () => {
  const { id } = useLocalSearchParams();
  const [order, setOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const loadedOnceRef = useRef(false);

  useEffect(() => {
    if (!id) {
      showAlert('Error', 'Order id missing');
      setLoading(false);
    }
  }, [id]);

  // Replaces the Firestore onSnapshot live listener with polling against the customer
  // account's own "my orders" endpoint (already aggregated across every restaurant it's
  // ordered from — see orderService.getMyOrders), filtered down to this one order. Runs
  // only while this screen is visible (utils/polling.ts). Only the FIRST load's failure
  // is worth an alert — a background refresh failing just keeps the last known order.
  usePolling(
    async () => {
      try {
        const orders = await getMyOrders();
        setOrder(orders.find((o) => o.id === id) || null);
        loadedOnceRef.current = true;
      } catch (err) {
        if (!loadedOnceRef.current && !isRateLimited(err)) {
          console.error('Error loading order:', err);
          showErrorAlert(err, 'Failed to load order. Please try again.', 'Error');
        }
      } finally {
        setLoading(false);
      }
    },
    ORDER_POLL_MS,
    Boolean(id)
  );

  if (loading) {
    return (
      <Container><PageHeader title="Order Details" /><Center>
        <ActivityIndicator size="large" color="#f68712" />
      </Center></Container>
    );
  }

  if (!order) {
    return (
      <Container>
        <PageHeader title="Order Details" />
        <EmptyText>Order not found.</EmptyText>
      </Container>
    );
  }

  const visibleOrderId = String(order.displayOrderId || `#${order.id}`);

  return (
    <Container>
      <PageHeader title="Order Details" />

      <Card>
        <Row>
          <OrderId>Order {visibleOrderId}</OrderId>
          <Status>{orderStatusLabel(order.status)}</Status>
        </Row>
        <SmallRow>
          <MetaText>{new Date(order.createdAt?.toDate?.() || order.createdAt).toLocaleString()}</MetaText>
          <MetaText>Total: ₹{(order.total || 0).toFixed(2)}</MetaText>
        </SmallRow>

        <Items>
          {order.items && order.items.map((it: any, index: number) => (
            <Item key={`${order.id}-${String(it.firebaseId || it.id || it.name || 'item')}-${index}`}>
              <ItemName>{it.name} x {it.quantity}</ItemName>
              <ItemPrice>₹{(it.price * it.quantity).toFixed(2)}</ItemPrice>
            </Item>
          ))}
        </Items>

        {order.pricing && (
          <Pricing>
            <PricingRow>
              <PricingLabel>Subtotal</PricingLabel>
              <PricingValue>₹{order.pricing.subtotal.toFixed(2)}</PricingValue>
            </PricingRow>
            <PricingRow>
              <PricingLabel>Discount</PricingLabel>
              <PricingValue>-₹{order.pricing.discount.toFixed(2)}</PricingValue>
            </PricingRow>
            <PricingRow>
              <PricingLabel>Packaging & Other Charges</PricingLabel>
              <PricingValue>₹{Number(order.pricing.packagingCharge || 0).toFixed(2)}</PricingValue>
            </PricingRow>
            <PricingRow>
              <PricingLabel>Delivery Fee</PricingLabel>
              <PricingValue>₹{Number(order.pricing.deliveryFee || 0).toFixed(2)}</PricingValue>
            </PricingRow>
            {(Number(order.pricing.walletUsed || 0) > 0) && (
              <PricingRow>
                <PricingLabel>Wallet Used</PricingLabel>
                <PricingValue>-₹{Number(order.pricing.walletUsed || 0).toFixed(2)}</PricingValue>
              </PricingRow>
            )}
            <Divider />
            <PricingRow>
              <PricingLabel>Total</PricingLabel>
              <PricingValue highlight>₹{order.total.toFixed(2)}</PricingValue>
            </PricingRow>
          </Pricing>
        )}
      </Card>
    </Container>
  );
};

export default OrderDetails;

const Container = styled(PageScreen)`
  flex: 1;
  background: #fff;
`;

const Center = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
`;

const EmptyText = styled.Text`
  margin-top: 40px;
  text-align: center;
  color: #666;
`;



const Card = styled.ScrollView`
  padding: 16px;
`;

const Row = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const SmallRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 6px;
`;

const OrderId = styled.Text`
  font-weight: 700;
`;

const Status = styled.Text`
  color: #fff;
  background: #27ae60;
  padding: 6px 10px;
  border-radius: 12px;
`;

const MetaText = styled.Text`
  color: #666;
  font-size: 12px;
`;

const Items = styled.View`
  margin-top: 12px;
`;

const Item = styled.View`
  flex-direction: row;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom-width: 1px;
  border-bottom-color: #f5f5f5;
`;

const ItemName = styled.Text``;
const ItemPrice = styled.Text``;

const Pricing = styled.View`
  margin-top: 16px;
  padding-top: 12px;
`;

const PricingRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const PricingLabel = styled.Text`
  color: #666;
`;

const PricingValue = styled.Text`
  color: ${(props: any) => props.highlight ? '#f68712' : '#333'};
  font-weight: ${(props: any) => props.highlight ? '700' : '600'};
`;

const Divider = styled.View`
  height: 1px;
  background: #eee;
  margin: 8px 0;
`;
