import { Icon } from './Icon';

export const ArrowLeft = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
    </Icon>
);
