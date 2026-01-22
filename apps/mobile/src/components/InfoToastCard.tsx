import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Animated, Easing } from 'react-native';
import { broadcastTheme } from '../theme/broadcastTheme';
import Capsule from './Capsule';

interface InfoToastCardProps {
    name: string;
    title?: string;
    federation?: string;
    rating?: number;
    flagEmoji?: string;
    visible: boolean;
    align?: 'left' | 'right';
}

const InfoToastCard = memo(({ name, title, rating, flagEmoji, visible, align = 'left' }: InfoToastCardProps) => {
    const opacity = useRef(new Animated.Value(0)).current;
    // Track mounted state to allow unmounting after fade-out
    const [isRendered, setIsRendered] = React.useState(visible);

    useEffect(() => {
        if (visible) {
            setIsRendered(true);
            Animated.timing(opacity, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
                easing: Easing.out(Easing.ease),
            }).start();
        } else {
            Animated.timing(opacity, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
                easing: Easing.in(Easing.ease),
            }).start(({ finished }) => {
                if (finished) setIsRendered(false);
            });
        }
    }, [visible]);

    if (!isRendered && !visible) return null;

    return (
        <Animated.View
            style={[
                styles.container,
                { opacity },
                align === 'right' ? styles.alignRight : styles.alignLeft
            ]}
            pointerEvents="none"
        >
            <View style={styles.content}>
                <View style={styles.header}>
                    {flagEmoji && <Text style={styles.flag}>{flagEmoji}</Text>}
                    {/* Removed invalid size="sm" prop */}
                    {title && <Capsule variant="title">{title}</Capsule>}
                </View>

                <Text style={styles.name} numberOfLines={2}>
                    {name}
                </Text>

                {rating && (
                    <Text style={styles.rating}>
                        Rat: <Text style={styles.ratingValue}>{rating}</Text>
                    </Text>
                )}
            </View>

            {/* Simple arrow/pointer */}
            <View style={[
                styles.arrow,
                align === 'right' ? styles.arrowRight : styles.arrowLeft
            ]} />
        </Animated.View>
    );
});

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: '100%',
        marginBottom: 10,
        zIndex: 1000,
        width: 180,
    },
    alignLeft: {
        left: 0,
    },
    alignRight: {
        right: 0,
    },
    content: {
        backgroundColor: '#1e293b', // slate-800
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
        gap: 6,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 2,
    },
    flag: {
        fontSize: 16,
    },
    name: {
        fontSize: 15,
        fontWeight: '700',
        color: '#f8fafc', // slate-50
        lineHeight: 20,
    },
    rating: {
        fontSize: 12,
        color: '#94a3b8', // slate-400
        fontWeight: '500',
    },
    ratingValue: {
        color: '#e2e8f0', // slate-200
        fontWeight: '600',
    },
    arrow: {
        position: 'absolute',
        bottom: -6,
        width: 12,
        height: 12,
        backgroundColor: '#1e293b', // match content bg
        borderBottomWidth: 1,
        borderRightWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        transform: [{ rotate: '45deg' }],
    },
    arrowLeft: {
        left: 20,
    },
    arrowRight: {
        right: 20,
    },
});

export default InfoToastCard;
