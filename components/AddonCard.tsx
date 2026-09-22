import React, { useState } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface AddonCardProps {
    addon: {
        id: string;
        name: string;
        imageUrl: string;
        price: number;
        isBestSeller?: boolean;
        isMostOrdered?: boolean;
        isBudgetPick?: boolean;
        isSellingFast?: boolean;
        discountPercent?: number;
        saveAmount?: number;
        tags?: string[];
        isPopular?: boolean;
        isTrending?: boolean;
    };
    quantity: number;
    onAdd: () => void;
    onIncrement: () => void;
    onDecrement: () => void;
}

export const AddonCard: React.FC<AddonCardProps> = React.memo(({ addon, quantity, onAdd, onIncrement, onDecrement }) => {
    const [fadeAnim] = useState(new Animated.Value(0));

    const handleAdd = () => {
        onAdd();
        Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    };

    // Determine badge
    let badge = null;
    let badgeColor = '#E6F4EA';
    let badgeTextColor = '#2E7D32';
    if (addon.isTrending || (addon.tags && addon.tags.includes('Trending'))) {
        badge = 'Trending';
        badgeColor = '#FFEFE3';
        badgeTextColor = '#FF9800';
    } else if (addon.isPopular || (addon.tags && addon.tags.includes('Popular'))) {
        badge = 'Popular';
        badgeColor = '#E6F4EA';
        badgeTextColor = '#2E7D32';
    }

    // Determine status
    let status = null;
    let statusColor = '#43b02a';
    let statusIcon = '●';
    if (addon.isBestSeller || (addon.tags && addon.tags.includes('Bestseller'))) {
        status = 'Bestseller';
        statusColor = '#43b02a';
        statusIcon = '●';
    } else if (addon.isTrending || (addon.tags && addon.tags.includes('Trending'))) {
        status = 'Trending';
        statusColor = '#FF9800';
        statusIcon = '🔥';
    }

    return (
        <View style={styles.card}>
            <View style={{ width: '100%', alignItems: 'flex-start', position: 'absolute', top: 10, left: 10, zIndex: 2 }}>
                {badge && (
                    <View style={[styles.badge, { backgroundColor: badgeColor }]}>
                        <Text style={[styles.badgeText, { color: badgeTextColor }]}>{badge}</Text>
                    </View>
                )}
            </View>
            {/* {addon.imageUrl ? ( */}
            <Image source={{ uri: "https://cdn.pixabay.com/photo/2017/07/24/19/57/tiger-2535888_640.jpg" }} style={styles.image} resizeMode="cover" />
            {/* ) : (
        <View style={[styles.image, { justifyContent: 'center', alignItems: 'center' }]}> 
          <Text style={{ color: '#bbb', fontSize: 24 }}>🍽️</Text>
        </View>
      )} */}
            {/* Add button */}
            {quantity === 0 ? (
                <TouchableOpacity style={styles.roundAddBtn} onPress={handleAdd}>
                    <Text style={styles.roundAddBtnText}>+</Text>
                </TouchableOpacity>
            ) : (
                <Animated.View style={[styles.stepper, { opacity: fadeAnim }]}>
                    <TouchableOpacity style={styles.stepBtn} onPress={onDecrement}>
                        <Text style={styles.stepText}>-</Text>
                    </TouchableOpacity>
                    <Text style={styles.qty}>{quantity}</Text>
                    <TouchableOpacity style={styles.stepBtn} onPress={onIncrement}>
                        <Text style={styles.stepText}>+</Text>
                    </TouchableOpacity>
                </Animated.View>
            )}
            <Text style={styles.name} numberOfLines={2}>{addon.name}</Text>
            <Text style={styles.price}>₹{addon.price}</Text>
            {status && (
                <View style={styles.statusRow}>
                    <Text style={[styles.statusIcon, { color: statusColor }]}>{statusIcon}</Text>
                    <Text style={[styles.statusText, { color: statusColor }]}>{status}</Text>
                </View>
            )}
        </View>
    );
});

AddonCard.displayName = 'AddonCard';

const styles = StyleSheet.create({
    card: {
        width: 160,
        borderRadius: 18,
        backgroundColor: '#fff',
        marginRight: 18,
        padding: 0,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 1,
        minHeight: 260,
        maxHeight: 280,
        justifyContent: 'flex-start',
        position: 'relative',
        overflow: 'hidden',
    },
    image: {
        width: 140,
        height: 110,
        borderRadius: 14,
        marginTop: 18,
        marginBottom: 18,
        backgroundColor: '#f2f2f2',
    },
    name: {
        fontWeight: '700',
        fontSize: 17,
        marginBottom: 2,
        color: '#222',
        textAlign: 'center',
        minHeight: 38,
        maxHeight: 40,
    },
    price: {
        fontWeight: '600',
        fontSize: 16,
        color: '#222',
        marginBottom: 8,
        textAlign: 'center',
    },
    roundAddBtn: {
        position: 'absolute',
        right: 12,
        top: 90,
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: '#ff7a00',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
    },
    roundAddBtnText: {
        color: '#ff7a00',
        fontWeight: '900',
        fontSize: 24,
        textAlign: 'center',
        marginTop: -2,
    },
    badge: {
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 8,
        marginBottom: 6,
    },
    badgeText: {
        fontWeight: '700',
        fontSize: 13,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
        justifyContent: 'center',
    },
    statusIcon: {
        fontSize: 16,
        marginRight: 4,
    },
    statusText: {
        fontWeight: '600',
        fontSize: 14,
    },
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f7f7f7',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 4,
        marginTop: 2,
    },
    stepBtn: {
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    stepText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#ff7a00',
    },
    qty: {
        fontSize: 15,
        fontWeight: '700',
        marginHorizontal: 6,
        color: '#222',
    },
});
