import { Icon } from './Icon';

export const Pin = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <path d="M12 17v5" />
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5a1 1 0 0 1 1-1h1V2H7v2h1a1 1 0 0 1 1 1z" />
    </Icon>
);
